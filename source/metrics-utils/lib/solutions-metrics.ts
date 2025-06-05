// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { Duration, CfnResource, Aws } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Schedule } from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { EventbridgeToLambda } from "@aws-solutions-constructs/aws-eventbridge-lambda";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Alarm, Metric, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";

import { LambdaToSqsToLambda } from "@aws-solutions-constructs/aws-lambda-sqs-lambda";
import { MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { ILogGroup, QueryDefinition, QueryDefinitionProps, QueryString } from "aws-cdk-lib/aws-logs";
import { ExecutionDay, MetricDataProps, SolutionsMetricProps } from "../lambda/helpers/types";
import {
  addLambdaBilledDurationMemorySize,
  addCloudFrontMetric,
  addLambdaInvocationCount,
  addECSAverageCPUUtilization,
  addECSAverageMemoryUtilization,
  addDynamoDBConsumedWriteCapacityUnits,
  addDynamoDBConsumedReadCapacityUnits,
} from "./query-builders";

export class SolutionsMetrics extends Construct {
  private metricDataQueries: MetricDataQuery[];
  private eventBridgeRule: CfnResource;
  private metricsLambdaFunction: NodejsFunction;
  private existingMetricIdentifiers: Set<string>;
  private queryDefinitionNames: Set<string>;

  constructor(scope: Construct, id: string, props: SolutionsMetricProps) {
    super(scope, id);
    const { VERSION } = process.env;
    this.metricsLambdaFunction = new NodejsFunction(this, "MetricsLambda", {
      description: "Metrics util",
      entry: path.join(__dirname, "../lambda/index.ts"),
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 128,
      environment: {
        QUERY_PREFIX: `${Aws.STACK_NAME}-`,
        SOLUTION_ID: scope.node.tryGetContext("solutionId"),
        SOLUTION_NAME: scope.node.tryGetContext("solutionName"),
        SOLUTION_VERSION: VERSION ?? scope.node.tryGetContext("solutionVersion"),
        UUID: props.uuid ?? "",
        EXECUTION_DAY: props.executionDay ? props.executionDay : ExecutionDay.MONDAY,
      },
    });

    const ruleToLambda = new EventbridgeToLambda(this, "EventbridgeRuleToLambda", {
      eventRuleProps: {
        schedule: Schedule.cron({
          minute: "0",
          hour: "23",
          weekDay: props.executionDay ? props.executionDay : ExecutionDay.MONDAY,
        }),
      },
      existingLambdaObj: this.metricsLambdaFunction,
    });

    props.queryProps?.map(this.addQueryDefinition.bind(this));

    this.metricDataQueries = [];
    this.eventBridgeRule = ruleToLambda.eventsRule.node.defaultChild as CfnResource;
    props.metricDataProps?.map(this.addMetricDataQuery.bind(this));

    // eslint-disable-next-line no-new
    const lambdaToSqsToLambda = new LambdaToSqsToLambda(this, "LambdaToSqsToLambda", {
      existingConsumerLambdaObj: ruleToLambda.lambdaFunction,
      existingProducerLambdaObj: ruleToLambda.lambdaFunction,
      queueProps: {
        deliveryDelay: Duration.minutes(15),
        visibilityTimeout: Duration.minutes(17),
        receiveMessageWaitTime: Duration.seconds(20),
        retentionPeriod: Duration.days(1),
        maxMessageSizeBytes: 1024,
      },
      deployDeadLetterQueue: false,
    });

    // Create SNS topic for alarm notifications (ISO 27001 compliance requirement)
    const alarmTopic = new Topic(this, "SqsAlarmTopic", {
      topicName: `${Aws.STACK_NAME}-sqs-monitoring-alerts`,
      displayName: "SQS Queue Monitoring Alerts",
    });

    // Create CloudWatch alarm for ApproximateAgeOfOldestMessage (ISO 27001 compliance)
    const ageOfOldestMessageAlarm = new Alarm(this, "SqsAgeOfOldestMessageAlarm", {
      alarmName: `${Aws.STACK_NAME}-sqs-age-of-oldest-message`,
      alarmDescription: "Alert when SQS messages are aging (ISO 27001 compliance)",
      metric: new Metric({
        namespace: "AWS/SQS",
        metricName: "ApproximateAgeOfOldestMessage",
        dimensionsMap: {
          QueueName: lambdaToSqsToLambda.sqsQueue.queueName,
        },
        statistic: "Maximum",
        period: Duration.minutes(5),
      }),
      threshold: 300, // 5 minutes in seconds
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    // Create CloudWatch alarm for ApproximateNumberOfMessages (general SQS monitoring)
    const numberOfMessagesAlarm = new Alarm(this, "SqsNumberOfMessagesAlarm", {
      alarmName: `${Aws.STACK_NAME}-sqs-number-of-messages`,
      alarmDescription: "Alert when SQS queue has too many pending messages",
      metric: new Metric({
        namespace: "AWS/SQS",
        metricName: "ApproximateNumberOfMessages",
        dimensionsMap: {
          QueueName: lambdaToSqsToLambda.sqsQueue.queueName,
        },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 100, // Adjust based on your requirements
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    // Create CloudWatch alarm for ApproximateNumberOfMessagesVisible
    const visibleMessagesAlarm = new Alarm(this, "SqsVisibleMessagesAlarm", {
      alarmName: `${Aws.STACK_NAME}-sqs-visible-messages`,
      alarmDescription: "Alert when SQS queue has too many visible messages",
      metric: new Metric({
        namespace: "AWS/SQS",
        metricName: "ApproximateNumberOfMessagesVisible",
        dimensionsMap: {
          QueueName: lambdaToSqsToLambda.sqsQueue.queueName,
        },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 50, // Adjust based on your requirements
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    // Add SNS actions to all alarms for notification (ISO 27001 compliance requirement)
    const snsAction = new SnsAction(alarmTopic);
    ageOfOldestMessageAlarm.addAlarmAction(snsAction);
    numberOfMessagesAlarm.addAlarmAction(snsAction);
    visibleMessagesAlarm.addAlarmAction(snsAction);

    // Create Lambda error rate monitoring (Vanta ISO 27001 compliance requirement)
    this.createLambdaErrorRateAlarm(this.metricsLambdaFunction.functionName, alarmTopic, "MetricsLambda");

    this.existingMetricIdentifiers = new Set<string>();
    this.queryDefinitionNames = new Set<string>();
  }

  /**
   * Creates CloudWatch alarms for Lambda function error rate monitoring
   * @param functionName The name of the Lambda function to monitor
   * @param alarmTopic The SNS topic to send notifications to
   * @param functionIdentifier A unique identifier for the function (for alarm naming)
   */
  private createLambdaErrorRateAlarm(functionName: string, alarmTopic: Topic, functionIdentifier: string): void {
    // Create alarm for Lambda errors (absolute count)
    const lambdaErrorsAlarm = new Alarm(this, `${functionIdentifier}ErrorsAlarm`, {
      alarmName: `${Aws.STACK_NAME}-lambda-${functionIdentifier.toLowerCase()}-errors`,
      alarmDescription: `Alert when Lambda function ${functionName} has errors (ISO 27001 compliance)`,
      metric: new Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
        dimensionsMap: {
          FunctionName: functionName,
        },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 1, // Alert on any errors
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    // Create alarm for Lambda error rate (errors vs invocations)
    const lambdaErrorRateAlarm = new Alarm(this, `${functionIdentifier}ErrorRateAlarm`, {
      alarmName: `${Aws.STACK_NAME}-lambda-${functionIdentifier.toLowerCase()}-error-rate`,
      alarmDescription: `Alert when Lambda function ${functionName} error rate exceeds threshold (ISO 27001 compliance)`,
      metric: new Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
        dimensionsMap: {
          FunctionName: functionName,
        },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 0.1, // 10% error rate
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    // Create alarm for Lambda duration (performance monitoring)
    const lambdaDurationAlarm = new Alarm(this, `${functionIdentifier}DurationAlarm`, {
      alarmName: `${Aws.STACK_NAME}-lambda-${functionIdentifier.toLowerCase()}-duration`,
      alarmDescription: `Alert when Lambda function ${functionName} duration is high (performance monitoring)`,
      metric: new Metric({
        namespace: "AWS/Lambda",
        metricName: "Duration",
        dimensionsMap: {
          FunctionName: functionName,
        },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 30000, // 30 seconds (adjust based on function timeout)
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    // Add SNS actions to all Lambda alarms
    const snsAction = new SnsAction(alarmTopic);
    lambdaErrorsAlarm.addAlarmAction(snsAction);
    lambdaErrorRateAlarm.addAlarmAction(snsAction);
    lambdaDurationAlarm.addAlarmAction(snsAction);
  }

  extractQueryFields(queryString: QueryString): string[] {
    const statsString = queryString.toString();
    if (!statsString) return [];

    const regex = /(\w+)\(([^)]+)\)\s+as\s+([^,]+?)(?:,|$)/gi;
    const matches = [...statsString.matchAll(regex)];
    return matches.map((match) => (match[3] ? match[3] : `${match[1]}_${match[2]}`));
  }

  addQueryDefinition(queryDefinitionProps: QueryDefinitionProps): void {
    const modifiedQueryDefinitionName = `${Aws.STACK_NAME}-${queryDefinitionProps.queryDefinitionName}`;
    // eslint-disable-next-line no-new
    new QueryDefinition(this, queryDefinitionProps.queryDefinitionName, {
      ...queryDefinitionProps,
      queryDefinitionName: modifiedQueryDefinitionName,
    });
    if (this.queryDefinitionNames.has(modifiedQueryDefinitionName)) {
      throw new Error(`Duplicate query definition name: ${modifiedQueryDefinitionName}.`);
    }
    this.queryDefinitionNames.add(modifiedQueryDefinitionName);

    const metricIdentifier = this.extractQueryFields(queryDefinitionProps.queryString);
    // Duplicate metric names would cause it to be impossible to determine which metric refers to which initial resource
    metricIdentifier.forEach((metricIdentifier) => {
      if (metricIdentifier && !metricIdentifier.match(/^\w*$/)) {
        throw new Error(`Identifier: ${metricIdentifier} must contain only alphanumeric characters and underscores`);
      }
      if (this.existingMetricIdentifiers.has(metricIdentifier)) {
        throw new Error(`Duplicate metric identifier: ${metricIdentifier}.`);
      }
      this.existingMetricIdentifiers.add(metricIdentifier);
    });

    queryDefinitionProps.logGroups?.map((logGroup: ILogGroup) =>
      logGroup.grant(this.metricsLambdaFunction, "logs:StartQuery", "logs:GetQueryResults")
    );
    this.metricsLambdaFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["logs:DescribeQueryDefinitions"],
        resources: ["*"],
      })
    );
  }

  addMetricDataQuery(metricDataProp: MetricDataProps): void {
    const identifierAddon = metricDataProp.identifier ? `/${metricDataProp.identifier}` : "";
    if (identifierAddon && !identifierAddon.match(/^[a-zA-Z0-9/]*$/)) {
      throw new Error(
        `Metric Identifier: ${identifierAddon} must contain only alphanumeric characters and forward slashes`
      );
    }

    const metricIdentifier = `${metricDataProp.MetricStat?.Metric?.Namespace}/${metricDataProp.MetricStat?.Metric?.MetricName}${identifierAddon}`;
    if (this.existingMetricIdentifiers.has(metricIdentifier)) {
      throw new Error(`Duplicate metric identifier: ${metricIdentifier}.`);
    }
    this.existingMetricIdentifiers.add(metricIdentifier);
    if (this.metricDataQueries.length === 0) {
      this.metricsLambdaFunction.addToRolePolicy(
        new PolicyStatement({
          actions: ["cloudwatch:GetMetricData"],
          resources: ["*"],
        })
      );
    }
    this.metricDataQueries.push({
      ...metricDataProp,
      Id: `id_${metricIdentifier.replace(/\//g, "_")}`,
    });
    this.eventBridgeRule.addOverride("Properties.Targets.0.InputTransformer", {
      InputPathsMap: {
        time: "$.time",
        "detail-type": "$.detail-type",
      },
      InputTemplate: `{"detail-type": <detail-type>, "time": <time>, "metrics-data-query": ${JSON.stringify(
        this.metricDataQueries
      )}}`,
    });
  }

  addLambdaInvocationCount: typeof addLambdaInvocationCount;
  addLambdaBilledDurationMemorySize: typeof addLambdaBilledDurationMemorySize;
  addCloudFrontMetric: typeof addCloudFrontMetric;
  addECSAverageCPUUtilization: typeof addECSAverageCPUUtilization;
  addECSAverageMemoryUtilization: typeof addECSAverageMemoryUtilization;
  addDynamoDBConsumedWriteCapacityUnits: typeof addDynamoDBConsumedWriteCapacityUnits;
  addDynamoDBConsumedReadCapacityUnits: typeof addDynamoDBConsumedReadCapacityUnits;

  /**
   * Public method to add Lambda error rate monitoring for external Lambda functions
   * @param functionName The name of the Lambda function to monitor
   * @param functionIdentifier A unique identifier for the function (for alarm naming)
   */
  public addLambdaErrorRateMonitoring(functionName: string, functionIdentifier: string): void {
    // Create SNS topic for alarms if it doesn't exist
    const alarmTopic = new Topic(this, `${functionIdentifier}AlarmTopic`, {
      topicName: `${Aws.STACK_NAME}-${functionIdentifier.toLowerCase()}-lambda-alerts`,
      displayName: `Lambda Error Rate Alerts for ${functionIdentifier}`,
    });

    this.createLambdaErrorRateAlarm(functionName, alarmTopic, functionIdentifier);
  }
}

Object.assign(SolutionsMetrics.prototype, {
  addLambdaInvocationCount,
  addLambdaBilledDurationMemorySize,
  addCloudFrontMetric,
  addECSAverageCPUUtilization,
  addECSAverageMemoryUtilization,
  addDynamoDBConsumedWriteCapacityUnits,
  addDynamoDBConsumedReadCapacityUnits,
});
