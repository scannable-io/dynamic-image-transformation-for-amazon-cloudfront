// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CognitoClient } from "./cognito-client";
import { DynamoDBClient } from "./dynamodb-client";

const globalTeardown = async (): Promise<void> => {
  console.log(" 💣 Running global teardown...");
  console.log(" 🧹 Clearing table and deleting test cognito app client");

  if (
    !process.env.USER_POOL_ID ||
    !process.env.TEST_CLIENT_ID ||
    !process.env.CURRENT_STACK_REGION ||
    !process.env.TABLE_NAME
  ) {
    throw new Error("environment variable is not set");
  }

  await new DynamoDBClient(process.env.CURRENT_STACK_REGION, process.env.TABLE_NAME).clearTable();

  const region = process.env.CURRENT_STACK_REGION;
  const cognitoClient = new CognitoClient(region);
  await cognitoClient.deleteCognitoAppClient({
    userPoolId: process.env.USER_POOL_ID,
    clientId: process.env.TEST_CLIENT_ID,
  });
  console.log(" 🏁 Global teardown complete");
};

export default globalTeardown;
