// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createAuthHeaders } from "./utils";

const { API_URL, TEST_ACCESS_TOKEN, CONSOLE_URL } = process.env;
if (!API_URL || !TEST_ACCESS_TOKEN || !CONSOLE_URL) {
  throw new Error("API_URL and TEST_ACCESS_TOKEN must be set in environment");
}

describe("CORS Headers E2E", () => {
  describe("OPTIONS preflight requests (API Gateway)", () => {
    test("OPTIONS /origins should not allow arbitrary origins", async () => {
      const response = await fetch(API_URL + "/origins", {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(response.status).toBe(204);

      const allowOrigin = response.headers.get("Access-Control-Allow-Origin");

      // Should NOT allow arbitrary origins or wildcard
      expect(allowOrigin).toBe(CONSOLE_URL);
    });
  });

  describe("GET list requests (Lambda)", () => {
    test("GET /origins should not allow arbitrary origins", async () => {
      const response = await fetch(API_URL + "/origins", {
        method: "GET",
        headers: {
          ...createAuthHeaders(TEST_ACCESS_TOKEN),
          Origin: "https://attacker.com",
        },
      });

      expect(response.status).toBe(200);

      const allowOrigin = response.headers.get("Access-Control-Allow-Origin");
      const allowCredentials = response.headers.get("Access-Control-Allow-Credentials");

      expect(allowOrigin).toBe(CONSOLE_URL);

      // Should allow credentials in cross-origin HTTP requests
      expect(allowCredentials).toBe("true");
    });

    test("GET /mappings should not allow arbitrary origins", async () => {
      const response = await fetch(API_URL + "/mappings", {
        method: "GET",
        headers: {
          ...createAuthHeaders(TEST_ACCESS_TOKEN),
          Origin: "https://evil.com",
        },
      });

      expect(response.status).toBe(200);

      const allowOrigin = response.headers.get("Access-Control-Allow-Origin");
      const allowCredentials = response.headers.get("Access-Control-Allow-Credentials");

      expect(allowOrigin).toBe(CONSOLE_URL);
      expect(allowCredentials).toBe("true");
    });

    test("GET /policies should not allow arbitrary origins", async () => {
      const response = await fetch(API_URL + "/policies", {
        method: "GET",
        headers: {
          ...createAuthHeaders(TEST_ACCESS_TOKEN),
          Origin: "https://malicious.com",
        },
      });

      expect(response.status).toBe(200);

      const allowOrigin = response.headers.get("Access-Control-Allow-Origin");
      const allowCredentials = response.headers.get("Access-Control-Allow-Credentials");

      expect(allowOrigin).toBe(CONSOLE_URL);
      expect(allowCredentials).toBe("true");
    });
  });
});
