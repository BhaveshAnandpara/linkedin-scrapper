import { describe, it, expect } from "vitest";
import { parseProfileUrl } from "../src/linkedin/identifiers.js";

describe("parseProfileUrl", () => {
  it("accepts a standard https URL with trailing slash", () => {
    expect(parseProfileUrl("https://www.linkedin.com/in/john-doe/")).toEqual({
      ok: true,
      publicIdentifier: "john-doe",
    });
  });

  it("accepts a URL without a trailing slash", () => {
    expect(parseProfileUrl("https://www.linkedin.com/in/john-doe")).toEqual({
      ok: true,
      publicIdentifier: "john-doe",
    });
  });

  it("accepts a URL without a protocol", () => {
    expect(parseProfileUrl("linkedin.com/in/john-doe")).toEqual({
      ok: true,
      publicIdentifier: "john-doe",
    });
  });

  it("accepts a URL without www", () => {
    expect(parseProfileUrl("https://linkedin.com/in/john-doe")).toEqual({
      ok: true,
      publicIdentifier: "john-doe",
    });
  });

  it("accepts an alphanumeric-suffixed slug", () => {
    expect(parseProfileUrl("https://www.linkedin.com/in/john-doe-1234abc")).toEqual({
      ok: true,
      publicIdentifier: "john-doe-1234abc",
    });
  });

  it("ignores query params after the slug", () => {
    expect(
      parseProfileUrl("https://www.linkedin.com/in/john-doe/?originalSubdomain=in"),
    ).toEqual({ ok: true, publicIdentifier: "john-doe" });
  });

  it("rejects a non-LinkedIn domain", () => {
    expect(parseProfileUrl("https://twitter.com/in/john-doe")).toEqual({
      ok: false,
      error: "INVALID_URL",
    });
  });

  it("rejects a /company/ path", () => {
    expect(parseProfileUrl("https://www.linkedin.com/company/some-company/")).toEqual({
      ok: false,
      error: "INVALID_URL",
    });
  });

  it("rejects an empty string", () => {
    expect(parseProfileUrl("")).toEqual({ ok: false, error: "INVALID_URL" });
  });

  it("rejects garbage input", () => {
    expect(parseProfileUrl("not a url at all")).toEqual({ ok: false, error: "INVALID_URL" });
  });

  it("rejects a profile path with no slug", () => {
    expect(parseProfileUrl("https://www.linkedin.com/in/")).toEqual({
      ok: false,
      error: "INVALID_URL",
    });
  });
});
