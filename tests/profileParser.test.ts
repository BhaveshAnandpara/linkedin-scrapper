import { describe, it, expect } from "vitest";
import { parseProfile } from "../src/linkedin/profileParser.js";
import profileFull from "./fixtures/profile-full.json" with { type: "json" };
import profileModerate from "./fixtures/profile-moderate.json" with { type: "json" };
import profileSparse from "./fixtures/profile-sparse.json" with { type: "json" };
import profileMinimal from "./fixtures/profile-minimal.json" with { type: "json" };

const REQUESTED_URL = "https://www.linkedin.com/in/some-person/";

function truthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

describe("parseProfile — rich real-captured profiles", () => {
  it.each([
    ["full", profileFull],
    ["moderate", profileModerate],
    ["sparse (actually rich)", profileSparse],
  ])("parses the %s fixture into a well-formed ProfileResponse", (_label, raw) => {
    const result = parseProfile(raw, REQUESTED_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profile = result.profile;
    expect(profile.requestedUrl).toBe(REQUESTED_URL);
    expect(truthy(profile.publicIdentifier)).toBe(true);
    expect(truthy(profile.name)).toBe(true);
    expect(truthy(profile.headline)).toBe(true);

    expect(Array.isArray(profile.experience)).toBe(true);
    expect(profile.experience.length).toBeGreaterThan(0);
    for (const entry of profile.experience) {
      expect(truthy(entry.title)).toBe(true);
      expect(typeof entry.isCurrent).toBe("boolean");
    }

    expect(Array.isArray(profile.education)).toBe(true);
    expect(profile.education.length).toBeGreaterThan(0);
    for (const entry of profile.education) {
      expect(truthy(entry.school)).toBe(true);
    }

    expect(Array.isArray(profile.skills)).toBe(true);
    expect(profile.skills.length).toBeGreaterThan(0);
    for (const skill of profile.skills) {
      expect(truthy(skill.name)).toBe(true);
    }

    expect(Array.isArray(profile.certifications)).toBe(true);
    expect(Array.isArray(profile.languages)).toBe(true);

    expect(typeof profile.meta.fetchedAt).toBe("string");
    expect(new Date(profile.meta.fetchedAt).toString()).not.toBe("Invalid Date");
    expect(typeof profile.meta.partial).toBe("boolean");
  });

  it("flags meta.partial and lists a limitation when a section is paginated (profile-moderate: 47 skills, only 20 returned)", () => {
    const result = parseProfile(profileModerate, REQUESTED_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.profile.meta.partial).toBe(true);
    expect(result.profile.meta.limitations).toBeDefined();
    expect(result.profile.meta.limitations!.some((l) => l.includes("skills"))).toBe(true);
  });

  it("extracts a profile image with a url when a vector image is present", () => {
    const result = parseProfile(profileModerate, REQUESTED_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.profile.profileImage).toBeDefined();
    expect(truthy(result.profile.profileImage!.url)).toBe(true);
    expect(result.profile.profileImages).toBeDefined();
    expect(result.profile.profileImages!.length).toBeGreaterThan(0);
  });

  it("flattens position groups into individual experience entries with dates and current-role handling", () => {
    const result = parseProfile(profileModerate, REQUESTED_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // profile-moderate's first position group has 3 nested roles, second has 1 -> 4 total.
    expect(result.profile.experience.length).toBe(4);
    const current = result.profile.experience.find((e) => e.title === "Linux Engineer");
    expect(current).toBeDefined();
    expect(current!.isCurrent).toBe(true);
    expect(current!.endDate).toBeNull();
    expect(current!.startDate).toEqual({ month: 1, year: 2026 });
  });
});

describe("parseProfile — synthetic minimal/sparse profile", () => {
  it("produces empty arrays and undefined optional fields without crashing", () => {
    const result = parseProfile(profileMinimal, REQUESTED_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profile = result.profile;
    expect(profile.name).toBe("Minimal Example");
    expect(profile.headline).toBe("Just a headline, nothing else");
    expect(profile.about).toBeUndefined();
    expect(profile.location).toBeUndefined();
    expect(profile.profileImage).toBeUndefined();
    expect(profile.profileImages).toBeUndefined();

    expect(profile.experience).toEqual([]);
    expect(profile.education).toEqual([]);
    expect(profile.skills).toEqual([]);
    expect(profile.certifications).toEqual([]);
    expect(profile.languages).toEqual([]);

    expect(profile.meta.partial).toBe(false);
    expect(profile.meta.limitations).toBeUndefined();
  });
});

describe("parseProfile — malformed input resilience", () => {
  it("returns NO_PROFILE_DATA when elements is missing", () => {
    const result = parseProfile({}, REQUESTED_URL);
    expect(result).toEqual({ ok: false, error: "NO_PROFILE_DATA" });
  });

  it("returns NO_PROFILE_DATA when elements is an empty array", () => {
    const result = parseProfile({ elements: [] }, REQUESTED_URL);
    expect(result).toEqual({ ok: false, error: "NO_PROFILE_DATA" });
  });

  it("does not crash when a profile element has no collections at all", () => {
    const result = parseProfile(
      { elements: [{ publicIdentifier: "bare", firstName: "Bare", lastName: "Bones" }] },
      REQUESTED_URL,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.experience).toEqual([]);
    expect(result.profile.education).toEqual([]);
    expect(result.profile.skills).toEqual([]);
  });
});
