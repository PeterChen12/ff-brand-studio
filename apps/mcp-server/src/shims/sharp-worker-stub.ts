/**
 * Cloudflare-Worker stub for the `sharp` module.
 *
 * Reason: sharp is a native libvips binding. It can't run in CF
 * Workers, but importing it from anywhere transitively reachable
 * from the worker entry pulls sharp/lib/sharp.js into the bundle,
 * which evaluates `detect-libc.familySync()` at module load and
 * crashes deploy validation (10021 — "process.report.getReport is
 * not implemented yet").
 *
 * wrangler.toml aliases the bare specifier `sharp` to this file in
 * the Worker bundle. In Node (vitest, the sidecar), no alias is in
 * effect, so the real sharp keeps working.
 *
 * Any function that ends up calling this stub inside the live Worker
 * was supposed to be routed through the image-sidecar instead — see
 * pipeline/sidecar.ts. If a runtime call lands here, that's the bug
 * to fix in the caller, not in this stub.
 */

function unsupported(): never {
  throw new Error(
    "[sharp-worker-stub] sharp is not available inside the Cloudflare Worker. " +
      "Route this call through the image-sidecar (pipeline/sidecar.ts) instead."
  );
}

// Sharp's public surface is `sharp(input, opts?)` returning a Sharp instance.
// We expose the same factory shape so static type-checking passes; the call
// itself just throws.
const sharpStub: (...args: unknown[]) => never = () => unsupported();

// Sharp also exposes a couple of static helpers we want to be safe to *touch*
// (read property, not call) at module load — protect them with throwing
// getters via Object.defineProperty.
Object.defineProperty(sharpStub, "format", { get: () => unsupported() });
Object.defineProperty(sharpStub, "versions", {
  get: () => ({ vips: "0.0.0-stub", sharp: "0.0.0-stub" }),
});
Object.defineProperty(sharpStub, "cache", { value: () => unsupported() });
Object.defineProperty(sharpStub, "concurrency", { value: () => unsupported() });
Object.defineProperty(sharpStub, "simd", { value: () => unsupported() });

export default sharpStub;
