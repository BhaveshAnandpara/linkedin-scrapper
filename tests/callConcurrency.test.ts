import { describe, it, expect, vi, beforeEach } from "vitest";

// A small in-memory stand-in for the handful of Redis commands
// callConcurrency.ts uses, so the actual acquire/release decision logic runs
// for real in these tests instead of just asserting on mocked call args.
function createFakeRedis() {
  const zset = new Map<string, number>();
  const kv = new Map<string, string>();

  return {
    async zremrangebyscore(_key: string, min: number, max: number) {
      let removed = 0;
      for (const [member, score] of zset) {
        if (score >= min && score <= max) {
          zset.delete(member);
          removed++;
        }
      }
      return removed;
    },
    async zcard() {
      return zset.size;
    },
    async zadd(_key: string, entry: { score: number; member: string }) {
      zset.set(entry.member, entry.score);
      return 1;
    },
    async zrem(_key: string, ...members: string[]) {
      let removed = 0;
      for (const member of members) {
        if (zset.delete(member)) {
          removed++;
        }
      }
      return removed;
    },
    async set(key: string, value: string, opts?: { nx?: boolean }) {
      if (opts?.nx && kv.has(key)) {
        return null;
      }
      kv.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return kv.has(key) ? kv.get(key)! : null;
    },
    async del(key: string) {
      return kv.delete(key) ? 1 : 0;
    },
  };
}

let fakeRedis: ReturnType<typeof createFakeRedis> | null;

vi.mock("../src/cache/redisClient.js", () => ({
  getRedisClient: () => fakeRedis,
}));

const {
  acquireCallSlot,
  releaseCallSlot,
  acquireIdentifierLock,
  releaseIdentifierLock,
} = await import("../src/linkedin/callConcurrency.js");

describe("acquireCallSlot / releaseCallSlot", () => {
  beforeEach(() => {
    fakeRedis = createFakeRedis();
    process.env.LINKEDIN_MAX_CONCURRENT_CALLS = "2";
  });

  it("degrades to unlimited when Redis is unconfigured", async () => {
    fakeRedis = null;
    const result = await acquireCallSlot(1000);
    expect(result).toEqual({ ok: true, leaseId: "" });
  });

  it("allows acquiring up to the configured concurrent limit", async () => {
    const first = await acquireCallSlot(1000);
    const second = await acquireCallSlot(1000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("rejects a request once the concurrent limit is reached", async () => {
    await acquireCallSlot(1000);
    await acquireCallSlot(1000);
    const third = await acquireCallSlot(1000);
    expect(third).toEqual({ ok: false });
  });

  it("frees a slot after release, allowing a new acquire to succeed", async () => {
    const first = await acquireCallSlot(1000);
    await acquireCallSlot(1000);
    expect((await acquireCallSlot(1000)).ok).toBe(false);

    if (first.ok) {
      await releaseCallSlot(first.leaseId);
    }

    expect((await acquireCallSlot(1000)).ok).toBe(true);
  });

  it("prunes expired leases before counting, freeing capacity without an explicit release", async () => {
    await acquireCallSlot(1000);
    await acquireCallSlot(1000);
    expect((await acquireCallSlot(1000)).ok).toBe(false);

    // Simulate time passing well past the lease TTL.
    const result = await acquireCallSlot(1000 + 60_000);
    expect(result.ok).toBe(true);
  });
});

describe("acquireIdentifierLock / releaseIdentifierLock", () => {
  beforeEach(() => {
    fakeRedis = createFakeRedis();
  });

  it("degrades to always-acquired when Redis is unconfigured", async () => {
    fakeRedis = null;
    expect(await acquireIdentifierLock("some-person", "lease-a")).toBe(true);
  });

  it("only the first concurrent acquire for the same identifier succeeds", async () => {
    const first = await acquireIdentifierLock("some-person", "lease-a");
    const second = await acquireIdentifierLock("some-person", "lease-b");
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("a different identifier is unaffected by an existing lock", async () => {
    await acquireIdentifierLock("some-person", "lease-a");
    expect(await acquireIdentifierLock("someone-else", "lease-b")).toBe(true);
  });

  it("releasing frees the lock for a subsequent acquire", async () => {
    await acquireIdentifierLock("some-person", "lease-a");
    await releaseIdentifierLock("some-person", "lease-a");
    expect(await acquireIdentifierLock("some-person", "lease-b")).toBe(true);
  });

  it("releasing with the wrong lease id does not delete someone else's lock", async () => {
    await acquireIdentifierLock("some-person", "lease-a");
    await releaseIdentifierLock("some-person", "wrong-lease");
    expect(await acquireIdentifierLock("some-person", "lease-b")).toBe(false);
  });
});
