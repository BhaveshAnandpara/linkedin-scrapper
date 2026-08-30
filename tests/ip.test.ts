import { describe, it, expect } from "vitest";
import { getClientIp } from "../src/utils/ip.js";

describe("getClientIp", () => {
  it("returns the first IP from a comma-separated x-forwarded-for header", () => {
    expect(getClientIp({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" })).toBe(
      "203.0.113.5",
    );
  });

  it("trims whitespace around the first forwarded IP", () => {
    expect(getClientIp({ "x-forwarded-for": "  203.0.113.5  , 70.41.3.18" })).toBe("203.0.113.5");
  });

  it("handles x-forwarded-for delivered as an array (Node http can do this)", () => {
    expect(getClientIp({ "x-forwarded-for": ["203.0.113.5", "70.41.3.18"] })).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(getClientIp({ "x-real-ip": "198.51.100.23" })).toBe("198.51.100.23");
  });

  it("falls back to the socket remote address when no headers are present", () => {
    expect(getClientIp({}, "192.0.2.1")).toBe("192.0.2.1");
  });

  it("returns 'unknown' when nothing is available", () => {
    expect(getClientIp({})).toBe("unknown");
  });

  it("ignores an empty x-forwarded-for value and falls through", () => {
    expect(getClientIp({ "x-forwarded-for": "" }, "192.0.2.1")).toBe("192.0.2.1");
  });
});
