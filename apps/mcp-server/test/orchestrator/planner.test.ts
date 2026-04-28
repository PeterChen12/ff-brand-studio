import { describe, expect, it } from "vitest";
import { planSkuLaunch } from "../../src/orchestrator/planner.js";
import type { Product } from "../../src/db/schema.js";

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "00000000-0000-0000-0000-000000000001",
    sellerId: "00000000-0000-0000-0000-000000000002",
    sku: "FAKE-001",
    nameEn: "Fake",
    nameZh: null,
    category: "drinkware",
    kind: "compact_square",
    dimensions: null,
    materials: null,
    colorsHex: null,
    loraUrl: null,
    triggerPhrase: null,
    brandConfig: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("planSkuLaunch", () => {
  it("plans 3 lifestyles for drinkware (default)", () => {
    const plan = planSkuLaunch({
      product: fakeProduct({ category: "drinkware" }),
      reference_count: 5,
      has_amazon_seller_id: true,
      platforms: ["amazon", "shopify"],
      include_video: false,
    });
    expect(plan.lifestyles).toHaveLength(3);
  });

  it("plans 1 lifestyle for tech-acc", () => {
    const plan = planSkuLaunch({
      product: fakeProduct({ category: "tech-acc" }),
      reference_count: 5,
      has_amazon_seller_id: true,
      platforms: ["amazon"],
      include_video: false,
    });
    expect(plan.lifestyles).toHaveLength(1);
  });

  it("does NOT generate variants when loraUrl is null (P0 #1)", () => {
    const plan = planSkuLaunch({
      product: fakeProduct({
        loraUrl: null,
        colorsHex: ["#000000", "#ffffff", "#0a1f44"],
      }),
      reference_count: 20, // would trigger train_lora=true
      has_amazon_seller_id: true,
      platforms: ["amazon"],
      include_video: false,
    });
    expect(plan.variants).toEqual([]);
    expect(plan.train_lora).toBe(true);
  });

  it("generates one variant per declared color when loraUrl exists", () => {
    const plan = planSkuLaunch({
      product: fakeProduct({
        loraUrl: "https://fal.ai/loras/fake-001.safetensors",
        colorsHex: ["#000000", "#ffffff", "#0a1f44"],
      }),
      reference_count: 5,
      has_amazon_seller_id: true,
      platforms: ["amazon"],
      include_video: false,
    });
    expect(plan.variants).toHaveLength(3);
    expect(plan.train_lora).toBe(false);
  });

  it("caps variants at 5 even with more declared colors", () => {
    const plan = planSkuLaunch({
      product: fakeProduct({
        loraUrl: "https://fal.ai/loras/fake-001.safetensors",
        colorsHex: ["#000", "#111", "#222", "#333", "#444", "#555", "#666", "#777"],
      }),
      reference_count: 5,
      has_amazon_seller_id: true,
      platforms: ["amazon"],
      include_video: false,
    });
    expect(plan.variants).toHaveLength(5);
  });

  it("requires amazon_seller_id AND non-tech-acc category to produce video", () => {
    const noSeller = planSkuLaunch({
      product: fakeProduct({ category: "drinkware" }),
      reference_count: 5,
      has_amazon_seller_id: false,
      platforms: ["amazon"],
      include_video: true,
    });
    expect(noSeller.produce_video).toBe(false);

    const techAcc = planSkuLaunch({
      product: fakeProduct({ category: "tech-acc" }),
      reference_count: 5,
      has_amazon_seller_id: true,
      platforms: ["amazon"],
      include_video: true,
    });
    expect(techAcc.produce_video).toBe(false);

    const ok = planSkuLaunch({
      product: fakeProduct({ category: "drinkware" }),
      reference_count: 5,
      has_amazon_seller_id: true,
      platforms: ["amazon"],
      include_video: true,
    });
    expect(ok.produce_video).toBe(true);
  });

  it("emits adapter_targets covering 5 Amazon + 4 Shopify slots = 9 base, +1 video = 10", () => {
    const plan = planSkuLaunch({
      product: fakeProduct({ category: "drinkware" }),
      reference_count: 5,
      has_amazon_seller_id: true,
      platforms: ["amazon", "shopify"],
      include_video: true,
    });
    expect(plan.adapter_targets.length).toBe(10);
    const amazonTargets = plan.adapter_targets.filter((t) => t.platform === "amazon");
    const shopifyTargets = plan.adapter_targets.filter((t) => t.platform === "shopify");
    expect(amazonTargets.length).toBe(6); // 5 base + video
    expect(shopifyTargets.length).toBe(4);
  });
});
