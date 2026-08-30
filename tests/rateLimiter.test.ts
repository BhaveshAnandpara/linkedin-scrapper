import { describe, it, expect } from "vitest";
import { shouldFailClosed } from "../src/rateLimit/rateLimiter.js";

describe("shouldFailClosed", () => {
  it("fails closed when VERCEL_ENV is production", () => {
    expect(shouldFailClosed("production")).toBe(true);
  });

  it("stays fail-open for preview deployments", () => {
    expect(shouldFailClosed("preview")).toBe(false);
  });

  it("stays fail-open for local development", () => {
    expect(shouldFailClosed("development")).toBe(false);
  });

  it("stays fail-open when VERCEL_ENV is unset (local dev outside Vercel)", () => {
    expect(shouldFailClosed(undefined)).toBe(false);
  });
});
