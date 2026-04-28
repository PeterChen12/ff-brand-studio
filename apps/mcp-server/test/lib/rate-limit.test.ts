import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client.js", () => ({
  createDbClient: () => ({
    execute: vi.fn(async () => [{ count: 1 }]),
  }),
}));

const { rateLimitMiddleware } = await import("../../src/lib/rate-limit.js");

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
      if (key === "tenant") return { ...baseTenant, ...overrides };
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

describe("rateLimitMiddleware (Postgres-backed)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls next when rate_limit_disabled feature is set", async () => {
    const ctx = makeCtx({ features: { rate_limit_disabled: true } });
    const next = vi.fn(async () => undefined);
    await rateLimitMiddleware(ctx as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next when no tenant on context (e.g. open route)", async () => {
    const ctx = {
      get: () => undefined,
      header: vi.fn(),
      json: vi.fn(),
      env: {} as Record<string, unknown>,
    };
    const next = vi.fn(async () => undefined);
    await rateLimitMiddleware(ctx as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("under-limit request calls next + sets X-RateLimit-* headers", async () => {
    const ctx = makeCtx({ plan: "free" });
    const next = vi.fn(async () => undefined);
    await rateLimitMiddleware(ctx as never, next);
    expect(next).toHaveBeenCalled();
    const h = (ctx as ReturnType<typeof makeCtx>).getHeaders();
    expect(h["X-RateLimit-Limit"]).toBe("60");
    expect(h["X-RateLimit-Remaining"]).toBe("59");
  });
});
