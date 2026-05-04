/**
 * Phase K2 — feedback-driven asset regeneration.
 *
 * Looks up an existing platform_assets row, charges 30¢ to the wallet
 * (refund-on-failure), and re-runs FAL Nano Banana Pro with the
 * existing studio reference + the user's feedback amended to the
 * deriver's standard refine prompt. Result is appended to the
 * asset's refinement_history and the row's r2Url + iter counter
 * are updated.
 *
 * Behind tenant.features.feedback_regen — caller checks before
 * invoking. We trust the caller.
 */

import { eq, and } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  platformAssets,
  productVariants,
  products,
  imageQaJudgments,
  type PlatformAsset,
  type Product,
} from "../db/schema.js";
import { sql } from "drizzle-orm";
import { auditEvent } from "./audit.js";
import {
  chargeWallet,
  creditWallet,
  InsufficientFundsError,
} from "./wallet.js";
import { getDeriver } from "../pipeline/derivers/index.js";
import { publicUrl } from "../pipeline/cache.js";

export const REGEN_COST_CENTS = 30;
// Image QA Layer 3 — per-asset cap on client-driven regenerations. After
// this, the dashboard's chat panel disables and points the user to a
// scheduled call. Tunable per-tenant in a future iteration.
export const CLIENT_REGEN_PER_ASSET_CAP = 5;

export interface RegenInput {
  assetId: string;
  tenantIdsInScope: string[];
  tenantId: string;
  actor: string | null;
  feedback: string;
  chips: string[];
}

export type RegenResult =
  | {
      ok: true;
      asset: PlatformAsset;
      newR2Url: string;
      costCents: number;
      clientIterations: { used: number; cap: number };
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "fal_missing"
        | "wallet"
        | "fal_error"
        | "asset_cap_reached";
      message?: string;
      clientIterations?: { used: number; cap: number };
    };

/**
 * Count the client-driven regenerations already attempted on a given
 * asset. Reads from image_qa_judgments where judge_id='client'.
 */
export async function countClientRegens(
  db: DbClient,
  assetId: string
): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(imageQaJudgments)
    .where(
      and(
        eq(imageQaJudgments.assetId, assetId),
        eq(imageQaJudgments.judgeId, "client")
      )
    );
  return Number(rows[0]?.c ?? 0);
}

export async function regenerateAsset(
  env: CloudflareBindings,
  db: DbClient,
  input: RegenInput
): Promise<RegenResult> {
  if (!env.FAL_KEY) return { ok: false, reason: "fal_missing" };

  const [asset] = await db
    .select()
    .from(platformAssets)
    .where(eq(platformAssets.id, input.assetId))
    .limit(1);
  if (!asset || !input.tenantIdsInScope.includes(asset.tenantId)) {
    return { ok: false, reason: "not_found" };
  }

  // Image QA Layer 3 — per-asset client-iteration cap. After 5 the
  // dashboard disables further iteration and points to Calendly. We
  // count BEFORE charging so a capped call doesn't burn a refund.
  const usedBefore = await countClientRegens(db, asset.id);
  if (usedBefore >= CLIENT_REGEN_PER_ASSET_CAP) {
    return {
      ok: false,
      reason: "asset_cap_reached",
      message: `${usedBefore}/${CLIENT_REGEN_PER_ASSET_CAP} client iterations already used on this asset.`,
      clientIterations: { used: usedBefore, cap: CLIENT_REGEN_PER_ASSET_CAP },
    };
  }

  // Resolve the parent product so we can pick the correct deriver.
  const [variant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, asset.variantId))
    .limit(1);
  if (!variant) return { ok: false, reason: "not_found" };
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, variant.productId))
    .limit(1);
  if (!product) return { ok: false, reason: "not_found" };

  // Charge wallet up-front; refund if FAL throws.
  try {
    await chargeWallet(db, {
      tenantId: input.tenantId,
      cents: REGEN_COST_CENTS,
      reason: "image_gen",
      referenceType: "regenerate",
      referenceId: asset.id,
    });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      return { ok: false, reason: "wallet", message: `${err.balanceCents}¢ available, need ${err.requestedCents}¢` };
    }
    throw err;
  }

  const deriver = getDeriver((product as Product).kind as ReturnType<typeof getDeriver>["kind"]);
  const basePrompt = deriver.refinePrompt({
    productName: product.nameEn,
    productNameZh: product.nameZh,
    category: product.category,
  });
  const chipBlock = input.chips.length
    ? "\nFix these issues called out by the operator:\n" + input.chips.map((c) => `  - ${c}`).join("\n")
    : "";
  const fbBlock = input.feedback.trim()
    ? `\nOperator feedback: ${input.feedback.trim().slice(0, 600)}`
    : "";
  const prompt = basePrompt + chipBlock + fbBlock;

  // Use the asset itself as both refs — refresh in-place. Production
  // pipeline's iter loop already proved [studio, crop] dual-ref is best;
  // for a regen-from-current we reference the current image twice and
  // trust the prompt amendments to drive the change.
  const currentUrl = asset.r2Url;
  let res: Response;
  try {
    res = await fetch("https://fal.run/fal-ai/gemini-3-pro-image-preview/edit", {
      method: "POST",
      headers: {
        authorization: `Key ${env.FAL_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_urls: [currentUrl, currentUrl],
        num_images: 1,
        output_format: "png",
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    await refundOnFail(db, input.tenantId, asset.id);
    return { ok: false, reason: "fal_error", message: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await refundOnFail(db, input.tenantId, asset.id);
    return { ok: false, reason: "fal_error", message: `${res.status}: ${text.slice(0, 200)}` };
  }

  const json = (await res.json()) as { images?: Array<{ url?: string }> };
  const imgUrl = json.images?.[0]?.url;
  if (!imgUrl) {
    await refundOnFail(db, input.tenantId, asset.id);
    return { ok: false, reason: "fal_error", message: "no image in fal response" };
  }

  const dl = await fetch(imgUrl, { signal: AbortSignal.timeout(60_000) });
  if (!dl.ok) {
    await refundOnFail(db, input.tenantId, asset.id);
    return { ok: false, reason: "fal_error", message: `download ${dl.status}` };
  }
  const bytes = await dl.arrayBuffer();
  const newKey = `tenant/${input.tenantId}/regen/${asset.id}/${Date.now()}.png`;
  await env.R2.put(newKey, bytes, { httpMetadata: { contentType: "image/png" } });
  const newR2Url = publicUrl(env, newKey);

  // Append the prior r2_url to refinement_history; flip current to new key.
  const history = Array.isArray(asset.refinementHistory) ? (asset.refinementHistory as Array<unknown>) : [];
  const updatedHistory = [
    ...history,
    {
      r2Url: asset.r2Url,
      replacedAt: new Date().toISOString(),
      feedback: input.feedback.slice(0, 600),
      chips: input.chips,
    },
  ];

  const [updated] = await db
    .update(platformAssets)
    .set({
      r2Url: newR2Url,
      refinementHistory: updatedHistory,
      modelUsed: "fal:gemini-3-pro-image-preview:regen",
    })
    .where(eq(platformAssets.id, asset.id))
    .returning();

  await auditEvent(db, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "wallet.debit",
    targetType: "platform_asset",
    targetId: asset.id,
    metadata: {
      reason: "regenerate",
      costCents: REGEN_COST_CENTS,
      chips: input.chips,
      feedback_chars: input.feedback.length,
    },
  });

  // Image QA Layer 3 — persist this client iteration so the cap counter
  // increments and the audit trail captures the freeform instruction
  // alongside model judgments.
  try {
    await db.insert(imageQaJudgments).values({
      tenantId: input.tenantId,
      assetId: asset.id,
      judgeId: "client",
      verdict: "rework",
      reason: input.feedback.slice(0, 500),
      model: "fal:gemini-3-pro-image-preview:regen",
      costCents: REGEN_COST_CENTS,
      iteration: usedBefore + 1,
      meta: {
        chips: input.chips,
        prior_r2_url: asset.r2Url,
        new_r2_url: newR2Url,
      },
    });
  } catch (persistErr) {
    console.warn(
      "[regen] image_qa_judgments persist failed",
      persistErr instanceof Error ? persistErr.message : String(persistErr)
    );
  }

  return {
    ok: true,
    asset: updated,
    newR2Url,
    costCents: REGEN_COST_CENTS,
    clientIterations: {
      used: usedBefore + 1,
      cap: CLIENT_REGEN_PER_ASSET_CAP,
    },
  };
}

async function refundOnFail(db: DbClient, tenantId: string, assetId: string): Promise<void> {
  try {
    await creditWallet(db, {
      tenantId,
      cents: REGEN_COST_CENTS,
      reason: "refund",
      referenceType: "regenerate_failed",
      referenceId: assetId,
    });
  } catch (err) {
    console.error("[regen refund] failed:", err);
  }
}
