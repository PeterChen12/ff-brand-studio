/**
 * Phase K3 — presigned GET URL for the export ZIP.
 *
 * R2 SigV4-presigned download URL. Default 7-day expiry per the plan.
 */

import { AwsClient } from "aws4fetch";

const REGION = "auto";
const SERVICE = "s3";
const ACCOUNT_ID = "40595082727ca8581658c1f562d5f1ff";
const BUCKET = "ff-brand-studio-assets";

export async function presignGetUrl(
  env: CloudflareBindings,
  key: string,
  expiresInSeconds: number = 7 * 24 * 3600
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: REGION,
    service: SERVICE,
  });

  const url = new URL(
    `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`
  );
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

  const signed = await client.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}
