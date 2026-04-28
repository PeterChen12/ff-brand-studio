import { describe, expect, it } from "vitest";
import { WEBHOOK_RETRY_POLICY } from "../../src/lib/webhooks.js";

describe("webhook retry policy", () => {
  it("has 5 attempts with the documented schedule", () => {
    expect(WEBHOOK_RETRY_POLICY.maxAttempts).toBe(5);
    // 1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours per the L4 plan.
    expect(WEBHOOK_RETRY_POLICY.delaysSeconds).toEqual([60, 300, 1800, 7200, 43200]);
  });

  it("delays are strictly increasing", () => {
    const ds = WEBHOOK_RETRY_POLICY.delaysSeconds;
    for (let i = 1; i < ds.length; i++) {
      expect(ds[i]).toBeGreaterThan(ds[i - 1]);
    }
  });
});

describe("HMAC signature verification (consumer side)", () => {
  it("Stripe-pattern header parses cleanly", () => {
    const header = "t=1714000000,v1=abc123def456";
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
    expect(parts.t).toBe("1714000000");
    expect(parts.v1).toBe("abc123def456");
  });
});
