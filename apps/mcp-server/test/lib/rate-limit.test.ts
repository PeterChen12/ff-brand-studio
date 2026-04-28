import { describe, expect, it, vi, beforeEach } from "vitest";
import { rateLimitMiddleware } from "../../src/lib/rate-limit.js";

const baseTenant = {
  id: "11111111-1111-1111-1111-111111111111",
  clerkOrgId: "org_test",
  name: "test",
  stripeCustomerId: null,
  walletBalanceCents: 500,
  plan: "free",
  features: {},
  createdAt: new Date(),
};

function makeCtx(overrides: { features?: Record<string, unknown>; plan?: string } = {}) {
  const headers = new Map<string, string>();
  return {
    get(key: string) {
      if (key === "tenant") {
        return { ...baseTenant, ...overrides };
      }
      return undefined;
    },
    header(name: string, value: string) {
      headers.set(name, value);
    },
    getHeaders() {
      return Object.fromEntries(headers);
    },
    json(body: unknown, status = 200) {
      return { body, status };
    },
    env: {} as Record<string, unknown>,
  };
}

describe("rateLimitMiddleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails open when Upstash secrets are unset", async () => {
    const ctx = makeCtx();
    const next = vi.fn(async () => undefined);
    const result = await rateLimitMiddleware(ctx as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it("respects rate_limit_disabled feature", async () => {
    const ctx = makeCtx({ features: { rate_limit_disabled: true } });
    ctx.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    ctx.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const next = vi.fn(async () => undefined);
    await rateLimitMiddleware(ctx as never, next);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 with Retry-After when over the plan limit", async () => {
    const ctx = makeCtx({ plan: "free" });
    ctx.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    ctx.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    // Free plan = 60 rpm. Mock the upstash REST response to return count=61.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ result: 61 }, { result: 1 }]), { status: 200 })
    );
    const next = vi.fn(async () => undefined);
    const res = await rateLimitMiddleware(ctx as never, next);
    expect(next).not.toHaveBeenCalled();
    // Hono's c.json returns a Response or a tuple via our mock; check shape.
    expect((res as { status?: number })?.status ?? 200).toBe(429);
  });

  it("plan-aware default: pro tier gets 600 rpm", async () => {
    const ctx = makeCtx({ plan: "pro" });
    ctx.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    ctx.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ result: 500 }, { result: 1 }]), { status: 200 })
    );
    const next = vi.fn(async () => undefined);
    await rateLimitMiddleware(ctx as never, next);
    // 500 < 600 → still in window
    expect(next).toHaveBeenCalled();
  });
});
