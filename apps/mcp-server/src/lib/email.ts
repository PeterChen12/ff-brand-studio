/**
 * Phase K3 — email helper using Resend.
 *
 * https://resend.com/docs/api-reference/emails/send-email
 *
 * Free tier covers Phase K + L volume comfortably (3K/mo). When the
 * key is missing we log + no-op so dev environments don't blow up.
 */

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

const DEFAULT_FROM = "FF Brand Studio <noreply@buyfishingrod.com>";

export async function sendEmail(
  env: CloudflareBindings,
  input: SendInput
): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY missing — skipping send to", input.to);
    return { ok: false, error: "resend_not_configured" };
  }

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: input.from ?? DEFAULT_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `resend ${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json()) as { id?: string };
  return { ok: true, id: json.id };
}

export function buildPublishEmail(args: {
  sku: string;
  productName: string;
  presignedUrl: string;
  amazonAssetCount: number;
  shopifyAssetCount: number;
}): { subject: string; html: string; text: string } {
  const subject = `${args.sku} export ready — ${args.productName}`;
  const text = [
    `Your bundle for ${args.sku} (${args.productName}) is ready to download.`,
    "",
    `Amazon assets: ${args.amazonAssetCount}`,
    `Shopify assets: ${args.shopifyAssetCount}`,
    "",
    `Download link (valid 7 days):`,
    args.presignedUrl,
    "",
    "Inside the ZIP:",
    "  - amazon.csv (Inventory File minimum columns)",
    "  - shopify.csv (Product CSV minimum columns)",
    "  - manifest.json (run + tenant + asset metadata)",
    "  - Per-platform image assets in slot-named folders",
  ].join("\n");
  const html = `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0e0e0d">
  <p style="font-size:14px;letter-spacing:0.05em;text-transform:uppercase;color:#777">FF Brand Studio</p>
  <h1 style="font-size:24px;margin:8px 0 16px">Your <code>${args.sku}</code> bundle is ready</h1>
  <p style="font-size:16px;line-height:1.6">${args.productName}</p>
  <p style="font-size:14px;color:#444">Amazon assets: <strong>${args.amazonAssetCount}</strong> · Shopify assets: <strong>${args.shopifyAssetCount}</strong></p>
  <p style="margin:32px 0">
    <a href="${args.presignedUrl}" style="display:inline-block;background:#1C3FAA;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">Download bundle</a>
  </p>
  <p style="font-size:12px;color:#888">Link valid for 7 days. Inside the ZIP: <code>amazon.csv</code> + <code>shopify.csv</code> + <code>manifest.json</code> + per-slot image folders.</p>
</body></html>`;
  return { subject, html, text };
}
