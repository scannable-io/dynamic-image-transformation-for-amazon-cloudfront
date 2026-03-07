// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { handler } from "../index";
import { CustomResourceActions, CustomResourceRequestTypes } from "../lib";

const mockFetch = jest.fn<any>();
global.fetch = mockFetch;

describe("V8 Custom Resource Handler", () => {
  const mockContext = { logStreamName: "test-log-stream" };
  const mockResponseURL = "https://cloudformation-response.example.com";

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
  });

  describe("CREATE_UUID action", () => {
    it("should generate UUID on CREATE", async () => {
      const event = {
        RequestType: CustomResourceRequestTypes.CREATE,
        ResourceProperties: {
          CustomAction: CustomResourceActions.CREATE_UUID,
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      const result = await handler(event, mockContext);

      expect(result.Status).toBe("SUCCESS");
      expect(result.Data.UUID).toBeDefined();
      expect(typeof result.Data.UUID).toBe("string");
      expect(mockFetch).toHaveBeenCalledWith(
        mockResponseURL,
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"UUID"'),
        })
      );
    });

    it("should not generate UUID on UPDATE", async () => {
      const event = {
        RequestType: CustomResourceRequestTypes.UPDATE,
        ResourceProperties: {
          CustomAction: CustomResourceActions.CREATE_UUID,
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      const result = await handler(event, mockContext);

      expect(result.Status).toBe("SUCCESS");
      expect(result.Data.UUID).toBeUndefined();
    });

    it("should not generate UUID on DELETE", async () => {
      const event = {
        RequestType: CustomResourceRequestTypes.DELETE,
        ResourceProperties: {
          CustomAction: CustomResourceActions.CREATE_UUID,
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      const result = await handler(event, mockContext);

      expect(result.Status).toBe("SUCCESS");
      expect(result.Data.UUID).toBeUndefined();
    });
  });

  describe("SEND_METRIC action", () => {
    it("should send metrics when AnonymousData is Yes", async () => {
      const event = {
        RequestType: CustomResourceRequestTypes.CREATE,
        ResourceProperties: {
          CustomAction: CustomResourceActions.SEND_METRIC,
          AnonymousData: "Yes",
          UUID: "test-uuid",
          Region: "us-east-1",
          UseExistingCloudFrontDistribution: "No",
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      const result = await handler(event, mockContext);

      expect(result.Status).toBe("SUCCESS");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://metrics.awssolutionsbuilder.com/generic",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("UseExistingCloudFrontDistribution"),
        })
      );
    });

    it("should not send metrics when AnonymousData is No", async () => {
      const event = {
        RequestType: CustomResourceRequestTypes.CREATE,
        ResourceProperties: {
          CustomAction: CustomResourceActions.SEND_METRIC,
          AnonymousData: "No",
          UUID: "test-uuid",
          Region: "us-east-1",
          UseExistingCloudFrontDistribution: "No",
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      const result = await handler(event, mockContext);

      expect(result.Status).toBe("SUCCESS");
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only CFN response, no metrics
    });

    it("should include UseExistingCloudFrontDistribution in payload", async () => {
      const event = {
        RequestType: CustomResourceRequestTypes.CREATE,
        ResourceProperties: {
          CustomAction: CustomResourceActions.SEND_METRIC,
          AnonymousData: "Yes",
          UUID: "test-uuid",
          Region: "us-west-2",
          UseExistingCloudFrontDistribution: "Yes",
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      const result = await handler(event, mockContext);

      expect(result.Status).toBe("SUCCESS");
      const postCalls = mockFetch.mock.calls.filter(
        (call) => (call[1] as RequestInit)?.method === "POST"
      );
      const payload = JSON.parse((postCalls[0][1] as RequestInit).body as string);
      expect(payload.Data.UseExistingCloudFrontDistribution).toBe("Yes");
      expect(payload.Data.Region).toBe("us-west-2");
    });

    it("should handle CREATE, UPDATE, and DELETE request types", async () => {
      const requestTypes = [
        CustomResourceRequestTypes.CREATE,
        CustomResourceRequestTypes.UPDATE,
        CustomResourceRequestTypes.DELETE,
      ];

      for (const requestType of requestTypes) {
        jest.clearAllMocks();

        const event = {
          RequestType: requestType,
          ResourceProperties: {
            CustomAction: CustomResourceActions.SEND_METRIC,
            AnonymousData: "Yes",
            UUID: "test-uuid",
            Region: "us-east-1",
            UseExistingCloudFrontDistribution: "No",
          },
          ResponseURL: mockResponseURL,
          StackId: "test-stack",
          RequestId: "test-request",
          LogicalResourceId: "test-resource",
        } as any;

        const result = await handler(event, mockContext);

        expect(result.Status).toBe("SUCCESS");
        const postCalls = mockFetch.mock.calls.filter(
          (call) => (call[1] as RequestInit)?.method === "POST"
        );
        const payload = JSON.parse((postCalls[0][1] as RequestInit).body as string);
        expect(payload.Data.Type).toBe(requestType);
      }
    });
  });

  describe("Error handling", () => {
    it("should return FAILED status on error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const event = {
        RequestType: CustomResourceRequestTypes.CREATE,
        ResourceProperties: {
          CustomAction: CustomResourceActions.SEND_METRIC,
          AnonymousData: "Yes",
          UUID: "test-uuid",
          Region: "us-east-1",
          UseExistingCloudFrontDistribution: "No",
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      const result = await handler(event, mockContext);

      expect(result.Status).toBe("SUCCESS");
      expect(result.Data.Message).toContain("failed");
    });

    it("should send CloudFormation response even on error", async () => {
      const event = {
        RequestType: CustomResourceRequestTypes.CREATE,
        ResourceProperties: {
          CustomAction: "invalidAction" as any,
        },
        ResponseURL: mockResponseURL,
        StackId: "test-stack",
        RequestId: "test-request",
        LogicalResourceId: "test-resource",
      } as any;

      await handler(event, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(mockResponseURL, expect.objectContaining({ method: "PUT" }));
    });
  });
});
