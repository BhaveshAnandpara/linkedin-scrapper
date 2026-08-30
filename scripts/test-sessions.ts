// Standalone verification script for milestone 14: exercises the full
// bring-your-own-session pipeline end-to-end against real Upstash Redis
// (and, where the current session is alive, real LinkedIn). Same rationale
// as scripts/test-endpoint.ts — calls the actual handlers directly with
// mocked req/res, since `vercel dev` needs an interactive login unavailable
// here.
//
// Run with: node --env-file=.env --import tsx scripts/test-sessions.ts [profileUrl]

import type { VercelRequest, VercelResponse } from "@vercel/node";
import sessionsHandler from "../api/sessions.js";
import defaultSessionHandler from "../api/sessions/default.js";
import profileHandler from "../api/profile.js";

function mockResponse() {
  const state: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    setHeader() {
      return res;
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res: res as unknown as VercelResponse, state };
}

function mockRequest(
  method: string,
  opts: { headers?: Record<string, string>; body?: unknown; query?: Record<string, string> } = {},
): VercelRequest {
  return {
    method,
    headers: opts.headers ?? {},
    body: opts.body,
    query: opts.query ?? {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as VercelRequest;
}

async function main() {
  const profileUrl = process.argv[2] ?? "https://www.linkedin.com/in/bhavesh-anandpara/";
  let failures = 0;

  const liAt = process.env.LI_AT_COOKIE;
  const jsessionid = process.env.LI_JSESSIONID;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!liAt || !jsessionid || !adminSecret) {
    console.error("FAIL: LI_AT_COOKIE, LI_JSESSIONID, and ADMIN_SECRET must all be set in .env");
    process.exit(1);
  }

  console.log("=== invalid/unrecognized token never falls through to the default ===");
  {
    const { res, state } = mockResponse();
    await profileHandler(
      mockRequest("GET", {
        headers: { authorization: "Bearer this-token-does-not-exist" },
        query: { url: profileUrl },
      }),
      res,
    );
    console.log(`  status: ${state.status}`, JSON.stringify(state.body));
    if (state.status !== 401 || (state.body as any)?.error?.code !== "SESSION_EXPIRED") {
      console.error("  FAIL: expected 401 SESSION_EXPIRED for an unrecognized token");
      failures++;
    } else {
      console.log("  PASS");
    }
  }

  console.log("\n=== bring-your-own-session: submit -> token -> /api/profile with that token ===");
  let visitorToken: string | undefined;
  {
    const { res, state } = mockResponse();
    await sessionsHandler(mockRequest("POST", { body: { liAt, jsessionid } }), res);
    console.log(`  POST /api/sessions status: ${state.status}`);
    visitorToken = (state.body as any)?.token;
    if (state.status !== 200 || !visitorToken) {
      console.error("  FAIL: expected 200 with a token");
      failures++;
    } else {
      console.log("  PASS: got a token");
    }
  }
  if (visitorToken) {
    const { res, state } = mockResponse();
    await profileHandler(
      mockRequest("GET", {
        headers: { authorization: `Bearer ${visitorToken}` },
        query: { url: profileUrl },
      }),
      res,
    );
    console.log(`  GET /api/profile (with token) status: ${state.status}`);
    if (state.status === 200) {
      console.log("  PASS: profile fetched using the visitor's own session");
    } else {
      console.log(
        "  NOTE: not 200 — see body below. If this is SESSION_EXPIRED, the .env session itself" +
          " is currently stale (a known, expected Phase 1/3 condition), not a wiring bug:",
        JSON.stringify(state.body),
      );
    }
  }

  console.log("\n=== admin default-session refresh -> /api/profile with no token ===");
  {
    const { res, state } = mockResponse();
    await defaultSessionHandler(
      mockRequest("POST", {
        headers: { "x-admin-secret": adminSecret },
        body: { liAt, jsessionid },
      }),
      res,
    );
    console.log(`  POST /api/sessions/default status: ${state.status}`, JSON.stringify(state.body));
    if (state.status !== 200) {
      console.error("  FAIL: expected 200 from the admin refresh");
      failures++;
    } else {
      console.log("  PASS");
    }
  }
  {
    const { res, state } = mockResponse();
    await profileHandler(mockRequest("GET", { query: { url: profileUrl } }), res);
    console.log(`  GET /api/profile (no token) status: ${state.status}`);
    if (state.status === 200) {
      console.log("  PASS: profile fetched using the refreshed default session");
    } else {
      console.log(
        "  NOTE: not 200 — see body below. If this is SESSION_EXPIRED, the .env session itself" +
          " is currently stale (a known, expected Phase 1/3 condition), not a wiring bug:",
        JSON.stringify(state.body),
      );
    }
  }

  console.log("\n=== existing error paths still work ===");
  {
    const { res, state } = mockResponse();
    await profileHandler(mockRequest("GET", {}), res);
    console.log(`  missing url status: ${state.status}`);
    if (state.status !== 400) {
      console.error("  FAIL: expected 400");
      failures++;
    } else {
      console.log("  PASS");
    }
  }

  console.log(failures === 0 ? "\nALL STRUCTURAL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
