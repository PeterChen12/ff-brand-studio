/**
 * FF Brand Studio — Image Sidecar (Phase I).
 *
 * Tiny Node + sharp service. The Cloudflare Worker calls these
 * endpoints over HTTPS with HMAC-SHA256(`${ts}.${sha256(body)}`)
 * signed against IMAGE_SIDECAR_SECRET. R2 keys are the only payload —
 * the sidecar reads/writes R2 itself via SigV4 and never sees Clerk
 * session state.
 *
 * Endpoints:
 *   POST /derive          — kind-aware crops (studio + 3 detail crops)
 *   POST /composite-text  — sharp SVG-overlay infographic
 *   POST /banner-extend   — 16:9 hero with gradient extension
 *   POST /force-white     — white-bg compliance snap
 *   GET  /healthz         — liveness probe
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { handleDerive } from "./ops/derive.js";
import { handleCompositeText } from "./ops/composite_text.js";
import { handleBannerExtend } from "./ops/banner_extend.js";
import { handleForceWhite } from "./ops/force_white.js";

const SECRET = process.env.IMAGE_SIDECAR_SECRET;
const PORT = Number(process.env.PORT ?? 8787);

if (!SECRET) {
  console.warn("[image-sidecar] IMAGE_SIDECAR_SECRET not set — refusing all signed requests");
}

const app = new Hono<{ Variables: { rawBody: string } }>();

app.get("/healthz", (c) => c.json({ ok: true, ts: Date.now() }));

app.use("/*", async (c, next) => {
  if (c.req.method === "GET") return next();
  if (!SECRET) return c.json({ error: "sidecar not configured" }, 503);

  const ts = c.req.header("x-ff-timestamp");
  const sig = c.req.header("x-ff-signature");
  if (!ts || !sig) return c.json({ error: "missing signature" }, 401);

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    return c.json({ error: "timestamp out of window" }, 401);
  }

  const body = await c.req.text();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const expected = createHmac("sha256", SECRET).update(`${ts}.${bodyHash}`).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return c.json({ error: "bad signature" }, 401);
  }

  // Re-attach the body for downstream handlers since we consumed it above.
  c.set("rawBody", body);
  await next();
});

app.post("/derive", async (c) => {
  try {
    const body = JSON.parse(c.get("rawBody") as string);
    const out = await handleDerive(body);
    return c.json(out);
  } catch (err) {
    console.error("[/derive]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/composite-text", async (c) => {
  try {
    const body = JSON.parse(c.get("rawBody") as string);
    const out = await handleCompositeText(body);
    return c.json(out);
  } catch (err) {
    console.error("[/composite-text]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/banner-extend", async (c) => {
  try {
    const body = JSON.parse(c.get("rawBody") as string);
    const out = await handleBannerExtend(body);
    return c.json(out);
  } catch (err) {
    console.error("[/banner-extend]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/force-white", async (c) => {
  try {
    const body = JSON.parse(c.get("rawBody") as string);
    const out = await handleForceWhite(body);
    return c.json(out);
  } catch (err) {
    console.error("[/force-white]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[image-sidecar] listening on :${PORT}`);
