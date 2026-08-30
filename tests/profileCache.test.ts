import { describe, it, expect, vi, beforeEach } from "vitest";

const getRedisClientMock = vi.fn();
vi.mock("../src/cache/redisClient.js", () => ({
  getRedisClient: () => getRedisClientMock(),
}));

const { getCachedProfile, setCachedProfile, waitForCachedProfile } = await import(
  "../src/cache/profileCache.js"
);

const SAMPLE_PROFILE = {
  requestedUrl: "https://www.linkedin.com/in/some-person/",
  publicIdentifier: "some-person",
  name: "Some Person",
  experience: [],
  education: [],
  skills: [],
  certifications: [],
  languages: [],
  meta: { fetchedAt: "2026-08-30T00:00:00.000Z", partial: false },
};

describe("profileCache", () => {
  beforeEach(() => {
    getRedisClientMock.mockReset();
  });

  it("getCachedProfile returns null when Redis is unconfigured (degrades to a live fetch)", async () => {
    getRedisClientMock.mockReturnValue(null);
    await expect(getCachedProfile("some-person")).resolves.toBeNull();
  });

  it("getCachedProfile returns the cached value on a hit", async () => {
    const get = vi.fn().mockResolvedValue(SAMPLE_PROFILE);
    getRedisClientMock.mockReturnValue({ get, set: vi.fn() });

    const result = await getCachedProfile("some-person");

    expect(result).toEqual(SAMPLE_PROFILE);
    expect(get).toHaveBeenCalledWith("profile-cache:some-person");
  });

  it("setCachedProfile is a no-op when Redis is unconfigured", async () => {
    getRedisClientMock.mockReturnValue(null);
    await expect(setCachedProfile("some-person", SAMPLE_PROFILE)).resolves.toBeUndefined();
  });

  it("setCachedProfile writes the profile under the identifier-scoped key with a TTL", async () => {
    const set = vi.fn().mockResolvedValue("OK");
    getRedisClientMock.mockReturnValue({ get: vi.fn(), set });

    await setCachedProfile("some-person", SAMPLE_PROFILE);

    expect(set).toHaveBeenCalledWith(
      "profile-cache:some-person",
      SAMPLE_PROFILE,
      expect.objectContaining({ ex: expect.any(Number) }),
    );
  });

  it("waitForCachedProfile returns as soon as the cache is populated", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SAMPLE_PROFILE);
    getRedisClientMock.mockReturnValue({ get, set: vi.fn() });

    let simulatedNow = 0;
    const now = () => simulatedNow;
    const sleep = vi.fn(async (ms: number) => {
      simulatedNow += ms;
    });

    const result = await waitForCachedProfile("some-person", 10_000, 250, now, sleep);

    expect(result).toEqual(SAMPLE_PROFILE);
    expect(get).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("waitForCachedProfile gives up once the deadline passes without a hit", async () => {
    const get = vi.fn().mockResolvedValue(null);
    getRedisClientMock.mockReturnValue({ get, set: vi.fn() });

    let simulatedNow = 0;
    const now = () => simulatedNow;
    const sleep = vi.fn(async (ms: number) => {
      simulatedNow += ms;
    });

    const result = await waitForCachedProfile("some-person", 1_000, 250, now, sleep);

    expect(result).toBeNull();
    expect(get).toHaveBeenCalledTimes(4);
  });
});
