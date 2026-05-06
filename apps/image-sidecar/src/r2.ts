/**
 * Sidecar R2 client — uses the AWS S3 SDK with the R2 endpoint, since
 * R2 is S3-API-compatible.
 *
 * Reads `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`,
 * `R2_BUCKET` (default ff-brand-studio-assets) from env.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  throw new Error(
    "R2 credentials missing — required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
  );
}
const BUCKET = process.env.R2_BUCKET ?? "ff-brand-studio-assets";

/** Render free tier ceiling is 512MB. A single 50MB PNG expanded to raw
 *  RGBA is ~16MB, but /derive runs four sharp pipelines concurrently on
 *  the same source, so we cap input bytes to keep the headroom. */
const MAX_R2_BYTES = 20 * 1024 * 1024;

const client = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

export async function getR2(key: string): Promise<Buffer> {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 get returned no body for ${key}`);
  if (typeof res.ContentLength === "number" && res.ContentLength > MAX_R2_BYTES) {
    throw new Error(
      `R2 object ${key} too large: ${res.ContentLength} > ${MAX_R2_BYTES} bytes`
    );
  }
  // Stream consumption with a running size guard for the case where the
  // server didn't return ContentLength.
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > MAX_R2_BYTES) {
      throw new Error(
        `R2 object ${key} stream exceeded ${MAX_R2_BYTES} bytes`
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function putR2(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );
}
