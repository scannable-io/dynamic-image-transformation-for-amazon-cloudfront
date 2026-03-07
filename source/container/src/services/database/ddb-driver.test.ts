// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { marshall } from '@aws-sdk/util-dynamodb';
import { DDBDriverImpl } from './ddb-driver';

const ddbMock = mockClient(DynamoDBClient);

describe('DDBDriverImpl', () => {
  const tableName = 'test-table';

  beforeEach(() => {
    ddbMock.reset();
  });

  describe('constructor', () => {
    it('Should use provided DynamoDB client', () => {
      const customClient = new DynamoDBClient({});
      const driver = new DDBDriverImpl(tableName, customClient);
      expect(driver).toBeDefined();
    });

    it('Should create default client when none provided', () => {
      const driver = new DDBDriverImpl(tableName);
      expect(driver).toBeDefined();
    });
  });

  describe('getAllPathMappings', () => {
    it('Should return empty array when no items exist', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllPathMappings();

      expect(result).toEqual([]);
    });

    it('Should return mapped path mappings', async () => {
      const item = marshall({
        GSI1SK: '/images/*',
        Data: { originId: 'origin-1', policyId: 'policy-1' }
      });
      ddbMock.on(QueryCommand).resolves({ Items: [item] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllPathMappings();

      expect(result).toEqual([{
        pathPattern: '/images/*',
        originId: 'origin-1',
        policyId: 'policy-1'
      }]);
    });

    it('Should handle pagination', async () => {
      const item1 = marshall({ GSI1SK: '/a/*', Data: { originId: 'o1' } });
      const item2 = marshall({ GSI1SK: '/b/*', Data: { originId: 'o2' } });

      ddbMock.on(QueryCommand)
        .resolvesOnce({ Items: [item1], LastEvaluatedKey: { PK: { S: 'key' } } })
        .resolvesOnce({ Items: [item2] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllPathMappings();

      expect(result).toHaveLength(2);
      expect(result[0].pathPattern).toBe('/a/*');
      expect(result[1].pathPattern).toBe('/b/*');
    });
  });

  describe('getAllHeaderMappings', () => {
    it('Should return mapped header mappings', async () => {
      const item = marshall({
        GSI1SK: 'images.example.com',
        Data: { originId: 'origin-1', policyId: 'policy-1' }
      });
      ddbMock.on(QueryCommand).resolves({ Items: [item] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllHeaderMappings();

      expect(result).toEqual([{
        hostPattern: 'images.example.com',
        originId: 'origin-1',
        policyId: 'policy-1'
      }]);
    });

    it('Should handle pagination', async () => {
      const item1 = marshall({ GSI1SK: 'a.com', Data: { originId: 'o1' } });
      const item2 = marshall({ GSI1SK: 'b.com', Data: { originId: 'o2' } });

      ddbMock.on(QueryCommand)
        .resolvesOnce({ Items: [item1], LastEvaluatedKey: { PK: { S: 'key' } } })
        .resolvesOnce({ Items: [item2] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllHeaderMappings();

      expect(result).toHaveLength(2);
    });
  });

  describe('getAllOrigins', () => {
    it('Should return mapped origins', async () => {
      const item = marshall({
        PK: 'origin-123',
        GSI1SK: 'My Origin',
        Data: {
          originDomain: 'cdn.example.com',
          originPath: '/assets',
          originHeaders: { 'x-api-key': 'secret' }
        }
      });
      ddbMock.on(QueryCommand).resolves({ Items: [item] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllOrigins();

      expect(result).toEqual([{
        originId: 'origin-123',
        originName: 'My Origin',
        originDomain: 'cdn.example.com',
        originPath: '/assets',
        originHeaders: { 'x-api-key': 'secret' }
      }]);
    });

    it('Should handle origins without optional fields', async () => {
      const item = marshall({
        PK: 'origin-123',
        GSI1SK: 'My Origin',
        Data: { originDomain: 'cdn.example.com' }
      });
      ddbMock.on(QueryCommand).resolves({ Items: [item] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllOrigins();

      expect(result[0].originPath).toBeUndefined();
      expect(result[0].originHeaders).toBeUndefined();
    });
  });

  describe('getAllPolicies', () => {
    it('Should return mapped policies', async () => {
      const item = marshall({
        PK: 'policy-123',
        GSI1SK: 'Thumbnail Policy',
        Data: {
          description: 'For thumbnails',
          policyJSON: '{"resize":{"width":100}}',
          isDefault: true
        }
      });
      ddbMock.on(QueryCommand).resolves({ Items: [item] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllPolicies();

      expect(result).toEqual([{
        policyId: 'policy-123',
        policyName: 'Thumbnail Policy',
        description: 'For thumbnails',
        policyJSON: '{"resize":{"width":100}}',
        isDefault: true
      }]);
    });

    it('Should default isDefault to false when missing', async () => {
      const item = marshall({
        PK: 'policy-123',
        GSI1SK: 'Policy',
        Data: { policyJSON: '{}' }
      });
      ddbMock.on(QueryCommand).resolves({ Items: [item] });

      const driver = new DDBDriverImpl(tableName, new DynamoDBClient({}));
      const result = await driver.getAllPolicies();

      expect(result[0].isDefault).toBe(false);
    });
  });
});
