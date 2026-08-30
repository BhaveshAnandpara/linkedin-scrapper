// Standalone verification script for milestone 5: exercises the actual
// api/health.ts and api/profile.ts handlers directly (mocking the Vercel
// request/response objects) against the live LinkedIn API. `vercel dev`
// requires an interactive browser login unavailable in this environment,
// so this calls the same handler code Vercel would invoke, just without
// its local dev proxy in front of it.
//
// Run with: node --env-file=.env --import tsx scripts/test-endpoint.ts [profileUrl]

import type { VercelRequest, VercelResponse } from "@vercel/node";
import healthHandler from "../api/health.js";
import profileHandler from "../api/profile.js";

function mockResponse() {
  const state: { status: number; body: unknown; headers: Record<string, string> } = {
    status: 200,
    body: undefined,
    headers: {},
  };
  const res = {
    setHeader(name: string, value: string) {
      state.headers[name] = value;
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

function mockRequest(query: Record<string, string>): VercelRequest {
  return {
    method: "GET",
    query,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as VercelRequest;
}

async function main() {
  const profileUrl = process.argv[2] ?? "https://www.linkedin.com/in/bhavesh-anandpara/";
  let failures = 0;

  console.log("=== GET /api/health ===");
  {
    const { res, state } = mockResponse();
    await healthHandler(mockRequest({}), res);
    console.log(`  status: ${state.status}`, JSON.stringify(state.body));
    if (state.status !== 200) {
      console.error("  FAIL: expected 200");
      failures++;
    } else {
      console.log("  PASS");
    }
  }

  console.log("\n=== GET /api/profile (missing url) ===");
  {
    const { res, state } = mockResponse();
    await profileHandler(mockRequest({}), res);
    console.log(`  status: ${state.status}`, JSON.stringify(state.body));
    if (state.status !== 400) {
      console.error("  FAIL: expected 400");
      failures++;
    } else {
      console.log("  PASS");
    }
  }

  console.log("\n=== GET /api/profile (garbage url) ===");
  {
    const { res, state } = mockResponse();
    await profileHandler(mockRequest({ url: "not a url at all" }), res);
    console.log(`  status: ${state.status}`, JSON.stringify(state.body));
    if (state.status !== 400) {
      console.error("  FAIL: expected 400");
      failures++;
    } else {
      console.log("  PASS");
    }
  }

  console.log(`\n=== GET /api/profile?url=${profileUrl} ===`);
  {
    const { res, state } = mockResponse();
    await profileHandler(mockRequest({ url: profileUrl }), res);
    if (state.status === 200) {
      const body = state.body as Record<string, unknown>;
      console.log(`  status: 200`);
      console.log(`  name: ${body.name}`);
      console.log(`  headline: ${body.headline}`);
      console.log(`  experience: ${(body.experience as unknown[])?.length}`);
      console.log(`  education: ${(body.education as unknown[])?.length}`);
      console.log(`  skills: ${(body.skills as unknown[])?.length}`);
      console.log("  PASS");
    } else {
      console.log(`  status: ${state.status}`, JSON.stringify(state.body));
      console.error("  FAIL: expected 200 (see error body above; may indicate SESSION_EXPIRED)");
      failures++;
    }
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
