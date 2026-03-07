// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createAuthHeaders } from "./utils";

const { API_URL, TEST_ACCESS_TOKEN } = process.env;
if (!API_URL || !TEST_ACCESS_TOKEN) {
  throw new Error("API_URL and TEST_ACCESS_TOKEN must be set in environment");
}

describe("Cache-Control Headers E2E", () => {
  describe("All API endpoints", () => {
    const endpoints = [
      { method: "GET", path: "/origins" },
      { method: "GET", path: "/policies" },
      { method: "GET", path: "/mappings" },
    ];

    test.each(endpoints)("$method $path should include Cache-Control header", async ({ method, path }) => {
      const response = await fetch(API_URL + path, {
        method,
        headers: createAuthHeaders(TEST_ACCESS_TOKEN),
      });

      expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache");
    });
  });

  describe("Error responses", () => {
    test("GET /origins/{invalidId} should include Cache-Control header on 400", async () => {
      const response = await fetch(API_URL + "/origins/non-existent-id", {
        method: "GET",
        headers: createAuthHeaders(TEST_ACCESS_TOKEN),
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache");
    });

    test("POST /origins with invalid body should include Cache-Control header on 400", async () => {
      const response = await fetch(API_URL + "/origins", {
        method: "POST",
        headers: {
          ...createAuthHeaders(TEST_ACCESS_TOKEN),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}), // Missing required fields
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache");
    });
  });
});
