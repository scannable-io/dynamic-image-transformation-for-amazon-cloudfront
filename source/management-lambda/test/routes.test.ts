// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

jest.mock("@aws-sdk/client-dynamodb");

describe("routes.ts DynamoDBClient configuration", () => {
  process.env.CONFIG_TABLE_NAME = "myTable"

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should configure DynamoDBClient with custom user agent when SOLUTION_ID and SOLUTION_VERSION are set in lambda env", () => {
    process.env.SOLUTION_ID = "SO0023";
    process.env.SOLUTION_VERSION = "v0.0.0-test";

    jest.isolateModules(() => {
      require("../routes");
    });

    expect(DynamoDBClient).toHaveBeenCalledTimes(1);
    expect(DynamoDBClient).toHaveBeenCalledWith(
      expect.objectContaining({
        customUserAgent: "AwsSolution/SO0023/v0.0.0-test",
      })
    );
  });

  it("should configure DynamoDBClient without custom user agent when SOLUTION_ID is not set", () => {
    delete process.env.SOLUTION_ID;
    delete process.env.SOLUTION_VERSION

    jest.isolateModules(() => {
      require("../routes");
    });

    expect(DynamoDBClient).toHaveBeenCalledTimes(1);
    expect(DynamoDBClient).toHaveBeenCalledWith(
      expect.not.objectContaining({
        customUserAgent: expect.any(String),
      })
    );
  });
});
