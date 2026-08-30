import { describe, it, expect } from "vitest";
import { resolveSessionSource } from "../src/sessions/sessionStore.js";

describe("resolveSessionSource", () => {
  it("prefers the token source when a token is available", () => {
    expect(
      resolveSessionSource({ hasToken: true, hasStoredDefault: true, hasEnvFallback: true }),
    ).toBe("token");
    expect(
      resolveSessionSource({ hasToken: true, hasStoredDefault: false, hasEnvFallback: false }),
    ).toBe("token");
  });

  it("falls back to the stored default when no token is available", () => {
    expect(
      resolveSessionSource({ hasToken: false, hasStoredDefault: true, hasEnvFallback: true }),
    ).toBe("default");
    expect(
      resolveSessionSource({ hasToken: false, hasStoredDefault: true, hasEnvFallback: false }),
    ).toBe("default");
  });

  it("falls back to the env var when no token or stored default is available", () => {
    expect(
      resolveSessionSource({ hasToken: false, hasStoredDefault: false, hasEnvFallback: true }),
    ).toBe("envFallback");
  });

  it("returns 'none' when nothing is available", () => {
    expect(
      resolveSessionSource({ hasToken: false, hasStoredDefault: false, hasEnvFallback: false }),
    ).toBe("none");
  });
});
