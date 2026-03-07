// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CloudFrontClient } from "@aws-sdk/client-cloudfront";

const mockSend = jest.fn().mockResolvedValue({
  DistributionConfig: { DefaultCacheBehavior: {} },
  ETag: "test-etag",
});

jest.mock("@aws-sdk/client-cloudfront", () => ({
  CloudFrontClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  GetDistributionConfigCommand: jest.fn(),
  UpdateDistributionCommand: jest.fn(),
}));

describe("csp-updater-handler CloudFrontClient configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should instantiate CloudFrontClient with custom user agent for Create event", async () => {
    process.env.SOLUTION_ID = "SO0023";
    process.env.SOLUTION_VERSION = "v0.0.0-test";

    const { handler } = await import("../../constructs/frontend/csp-updater-handler");

    const event = {
      RequestType: "Create",
      ResourceProperties: {
        DistributionId: "test-dist-id",
        ResponseHeadersPolicyId: "test-policy-id",
      },
    };

    await handler(event as any, {} as any);

    expect(CloudFrontClient).toHaveBeenCalledTimes(1);
    expect(CloudFrontClient).toHaveBeenCalledWith(
      expect.objectContaining({
        customUserAgent: "AwsSolution/SO0023/v0.0.0-test",
      })
    );
  });

  it("should instantiate CloudFrontClient with custom user agent for Delete event", async () => {
    const { handler } = await import("../../constructs/frontend/csp-updater-handler");

    const event = {
      RequestType: "Delete",
      ResourceProperties: {
        DistributionId: "test-dist-id",
        ResponseHeadersPolicyId: "test-policy-id",
      },
    };

    await handler(event as any, {} as any);

    expect(CloudFrontClient).toHaveBeenCalledTimes(1);
    expect(CloudFrontClient).toHaveBeenCalledWith(
      expect.objectContaining({
        customUserAgent: "AwsSolution/SO0023/v0.0.0-test",
      })
    );
  });

  it("should instantiate CloudFrontClient without custom user agent when SOLUTION_ID is not set", async () => {
    delete process.env.SOLUTION_ID;
    delete process.env.SOLUTION_VERSION;

    const { handler } = await import("../../constructs/frontend/csp-updater-handler");

    const event = {
      RequestType: "Create",
      ResourceProperties: {
        DistributionId: "test-dist-id",
        ResponseHeadersPolicyId: "test-policy-id",
      },
    };

    await handler(event as any, {} as any);

    expect(CloudFrontClient).toHaveBeenCalledTimes(1);
    expect(CloudFrontClient).toHaveBeenCalledWith(
      expect.not.objectContaining({
        customUserAgent: expect.any(String),
      })
    );
  });
});
