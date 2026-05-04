import Langfuse from "langfuse";

let _langfuse: Langfuse | null = null;

/**
 * P2-3 — fail loud in production when LANGFUSE_BASE_URL isn't set.
 * Previously we silently fell back to https://cloud.langfuse.com which
 * meant a misconfigured prod deploy quietly routed traces to the public
 * cloud while the engineer thought tracing was broken; debugging then
 * starts from "the dashboard is empty" and never finds the real cause.
 */
export function getLangfuse(env: CloudflareBindings): Langfuse {
  if (!_langfuse) {
    const baseUrl = env.LANGFUSE_BASE_URL;
    if (!baseUrl && env.ENVIRONMENT === "production") {
      throw new Error(
        "LANGFUSE_BASE_URL is required in production. Set it as a Worker secret " +
          "(self-hosted: https://langfuse.your-domain.com; managed: " +
          "https://cloud.langfuse.com)."
      );
    }
    _langfuse = new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: baseUrl || "https://cloud.langfuse.com",
    });
  }
  return _langfuse;
}

export function resetLangfuse(): void {
  _langfuse = null;
}
