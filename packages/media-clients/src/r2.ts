export interface R2UploadResult {
  publicUrl: string;
  key: string;
}

export async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer,
  contentType: string,
  publicBaseUrl: string
): Promise<R2UploadResult> {
  await bucket.put(key, data, {
    httpMetadata: { contentType },
  });

  const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
  return { publicUrl, key };
}

export async function uploadBase64ToR2(
  bucket: R2Bucket,
  key: string,
  b64: string,
  contentType: string,
  publicBaseUrl: string
): Promise<R2UploadResult> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return uploadToR2(bucket, key, bytes.buffer, contentType, publicBaseUrl);
}
