/**
 * R2 presigned PUT URLs — Phase H1.3.
 *
 * R2's S3-compatible API expects SigV4 signatures. We use `aws4fetch`
 * (3kB, no Node deps, runs on Workers natively) which builds the
 * canonical request, computes the signature, and returns a signed URL
 * suitable for the browser to PUT directly against.
 *
 * Tenant-scoped key prefix: `tenant/<tid>/uploads/<intent>/<i>.<ext>`.
 * Listing under R2 by prefix lets us audit per-tenant storage cheaply.
 */

import { AwsClient } from "aws4fetch";

const REGION = "auto"; // R2 uses "auto" not a real AWS region
const SERVICE = "s3";
const ACCOUNT_ID = "40595082727ca8581658c1f562d5f1ff";
const BUCKET = "ff-brand-studio-assets";
const PUBLIC_HOST = "pub-db3f39e3386347d58359ba96517eec84.r2.dev";

export interface PresignInput {
  env: CloudflareBindings;
  tenantId: string;
  intentId: string;
  index: number;
  ext: "jpg" | "jpeg" | "png" | "webp";
  contentType?: string;
  expiresInSeconds?: number;
}

export interface PresignedUrl {
  key: string;
  putUrl: string;
  publicUrl: string;
  expiresAt: string;
}

const CONTENT_TYPE_FOR: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function presignPutUrl(input: PresignInput): Promise<PresignedUrl> {
  const ext = input.ext;
  const key = `tenant/${input.tenantId}/uploads/${input.intentId}/${input.index}.${ext}`;
  const expires = input.expiresInSeconds ?? 600; // 10 min
  const contentType = input.contentType ?? CONTENT_TYPE_FOR[ext];

  const client = new AwsClient({
    accessKeyId: input.env.R2_ACCESS_KEY_ID,
    secretAccessKey: input.env.R2_SECRET_ACCESS_KEY,
    region: REGION,
    service: SERVICE,
  });

  // Build the URL for the bucket; aws4fetch will sign it.
  const url = new URL(
    `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`
  );
  url.searchParams.set("X-Amz-Expires", String(expires));

  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: { "content-type": contentType },
    }),
    { aws: { signQuery: true } }
  );

  const expiresAt = new Date(Date.now() + expires * 1000).toISOString();
  return {
    key,
    putUrl: signed.url,
    publicUrl: `https://${PUBLIC_HOST}/${key}`,
    expiresAt,
  };
}

/** HEAD an object to verify it actually got uploaded. */
export async function verifyR2Object(
  env: CloudflareBindings,
  key: string
): Promise<{ exists: boolean; contentLength: number | null }> {
  const obj = await env.R2.head(key);
  if (!obj) return { exists: false, contentLength: null };
  return { exists: true, contentLength: obj.size ?? null };
}
