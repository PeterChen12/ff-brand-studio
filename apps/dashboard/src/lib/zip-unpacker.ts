"use client";

/**
 * Phase E · Iter 06 — client-side zip unwrap for the bulk-upload flow.
 *
 * Operators frequently get vendor batches as a single .zip file
 * (Google Drive's "Download all" wraps multiple files into a zip;
 * Bearking's batch arrived this way). The bulk-upload form already
 * understands a folder-of-folders shape via webkitRelativePath; this
 * helper unpacks a zip into synthetic Files with the same shape so
 * the existing parseFolders() logic in /products/bulk/_client.tsx
 * needs no further changes.
 *
 * Handles nested zips up to depth 2 (Google Drive sometimes wraps a
 * zip inside a zip). Deeper nesting is rejected — operator should
 * re-zip flattened.
 *
 * Size cap: 100 MB total uncompressed, enforced at the bulk-form's
 * existing batch level.
 */

import type JSZipNS from "jszip";

const MAX_ZIP_DEPTH = 2;
const SUPPORTED_FILE_EXT = /\.(jpe?g|png|webp|json|txt|md)$/i;

interface UnpackedFile {
  /** Synthetic File the bulk-form's parseFolders() can consume. */
  file: File;
}

export interface UnpackResult {
  files: UnpackedFile[];
  errors: string[];
}

/**
 * Walk a JSZip instance, returning every leaf entry that's either a
 * supported file extension OR a nested zip (which gets recursively
 * unpacked). Each entry is materialised as a real File object with
 * `webkitRelativePath` set so downstream folder-bucketing works.
 */
async function walkZip(
  zip: JSZipNS,
  pathPrefix: string,
  depth: number,
  errors: string[]
): Promise<UnpackedFile[]> {
  const out: UnpackedFile[] = [];
  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const fullPath = `${pathPrefix}${entryPath}`;

    // Nested zip — recurse if we haven't blown the depth cap.
    if (entryPath.toLowerCase().endsWith(".zip")) {
      if (depth >= MAX_ZIP_DEPTH) {
        errors.push(
          `${fullPath}: nested zip beyond depth ${MAX_ZIP_DEPTH} — re-zip flattened`
        );
        continue;
      }
      try {
        const innerBuf = await entry.async("arraybuffer");
        const JSZip = (await import("jszip")).default;
        const innerZip = await JSZip.loadAsync(innerBuf);
        const stem = entryPath.replace(/\.zip$/i, "");
        const inner = await walkZip(
          innerZip,
          `${pathPrefix}${stem}/`,
          depth + 1,
          errors
        );
        out.push(...inner);
      } catch (err) {
        errors.push(
          `${fullPath}: failed to unpack nested zip — ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      continue;
    }

    // Filter to file types the bulk form understands; silently skip
    // anything else (Mac's .DS_Store, hidden files, etc.).
    if (!SUPPORTED_FILE_EXT.test(entryPath)) continue;

    try {
      const buf = await entry.async("arraybuffer");
      // Pick a mime type by extension — JSZip doesn't carry it.
      const ext = entryPath.split(".").pop()?.toLowerCase() ?? "";
      const mime =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : ext === "json"
                ? "application/json"
                : "text/plain";
      const baseName = entryPath.split("/").pop() ?? entryPath;
      const file = new File([buf], baseName, { type: mime });
      // The bulk form reads `webkitRelativePath` to bucket files by
      // their immediate parent folder. We synthesize it from the zip
      // path so `BulkBatch/sku-001/hero.jpg` ends up in the sku-001
      // bucket, matching the operator's mental model.
      Object.defineProperty(file, "webkitRelativePath", {
        value: fullPath,
        writable: false,
      });
      out.push({ file });
    } catch (err) {
      errors.push(
        `${fullPath}: failed to extract — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return out;
}

/**
 * Public entry point. Takes a single .zip File, returns the flat list
 * of synthetic Files the bulk form can consume + any errors encountered.
 *
 * The returned files have `webkitRelativePath` set to the path inside
 * the zip (with the zip's basename as the root segment so all files
 * share a common top-level parent and bucket correctly).
 */
export async function unpackZip(zipFile: File): Promise<UnpackResult> {
  const errors: string[] = [];
  try {
    const buf = await zipFile.arrayBuffer();
    const JSZip = (await import("jszip")).default;
    const root = await JSZip.loadAsync(buf);
    // Synthesize the top-level folder name from the zip's basename so
    // every file inside ends up under one common prefix. parseFolders
    // expects each product to be the IMMEDIATE child of this root.
    const rootName = zipFile.name.replace(/\.zip$/i, "") || "BulkBatch";
    const files = await walkZip(root, `${rootName}/`, 1, errors);
    return { files, errors };
  } catch (err) {
    errors.push(
      `Failed to open zip — ${err instanceof Error ? err.message : String(err)}`
    );
    return { files: [], errors };
  }
}
