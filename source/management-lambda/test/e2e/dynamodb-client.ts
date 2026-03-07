// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DynamoDBClient as DDBClient, ScanCommand, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { ScanCommandOutput } from "@aws-sdk/lib-dynamodb";

export class DynamoDBClient {
  private readonly ddbClient: DDBClient;

  constructor(
    region: string,
    private readonly tableName: string
  ) {
    this.ddbClient = new DDBClient({ region });
    this.tableName = tableName;
  }

  async deleteAllItems() {
    let itemsDeleted = 0;
    let lastEvaluatedKey;

    do {
      const scanResult: ScanCommandOutput = await this.ddbClient.send(
        new ScanCommand({
          TableName: this.tableName,
          ProjectionExpression: "PK",
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (scanResult.Items && scanResult.Items.length > 0) {
        const deleteRequests = scanResult.Items.map((item) => ({
          DeleteRequest: { Key: { PK: item.PK } },
        }));

        // BatchWriteItem supports max 25 items per request
        for (let i = 0; i < deleteRequests.length; i += 25) {
          const batch = deleteRequests.slice(i, i + 25);
          await this.ddbClient.send(
            new BatchWriteItemCommand({
              RequestItems: { [this.tableName]: batch },
            })
          );
          itemsDeleted += batch.length;
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  }

  async clearTable() {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.deleteAllItems();

      const scanResult = await this.ddbClient.send(
        new ScanCommand({
          TableName: this.tableName,
          Select: "COUNT",
        })
      );

      if (!scanResult.Count || scanResult.Count === 0) {
        return;
      }

      if (attempt < maxRetries) {
        console.log(` 🔁 Table still contains ${scanResult.Count} items, retrying (${attempt}/${maxRetries})...`);
      } else {
        throw new Error(`Table still contains ${scanResult.Count} items after ${maxRetries} attempts`);
      }
    }
  }
}
