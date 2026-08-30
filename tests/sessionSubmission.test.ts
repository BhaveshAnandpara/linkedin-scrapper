import { describe, it, expect } from "vitest";
import { parseSessionSubmission } from "../src/sessions/sessionStore.js";

describe("parseSessionSubmission", () => {
  it("accepts a body with liAt and jsessionid", () => {
    expect(parseSessionSubmission({ liAt: "abc", jsessionid: "def" })).toEqual({
      liAt: "abc",
      jsessionid: "def",
      userAgent: undefined,
    });
  });

  it("accepts an optional userAgent string", () => {
    expect(
      parseSessionSubmission({ liAt: "abc", jsessionid: "def", userAgent: "Mozilla/5.0" }),
    ).toEqual({
      liAt: "abc",
      jsessionid: "def",
      userAgent: "Mozilla/5.0",
    });
  });

  it("rejects a non-object body", () => {
    expect(parseSessionSubmission("not an object")).toBeNull();
    expect(parseSessionSubmission(null)).toBeNull();
    expect(parseSessionSubmission(undefined)).toBeNull();
  });

  it("rejects a missing liAt", () => {
    expect(parseSessionSubmission({ jsessionid: "def" })).toBeNull();
  });

  it("rejects a missing jsessionid", () => {
    expect(parseSessionSubmission({ liAt: "abc" })).toBeNull();
  });

  it("rejects an empty or whitespace-only liAt", () => {
    expect(parseSessionSubmission({ liAt: "   ", jsessionid: "def" })).toBeNull();
  });

  it("rejects a non-string userAgent", () => {
    expect(parseSessionSubmission({ liAt: "abc", jsessionid: "def", userAgent: 123 })).toBeNull();
  });
});
