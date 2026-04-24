import Langfuse from "langfuse";

let _langfuse: Langfuse | null = null;

export function getLangfuse(env: CloudflareBindings): Langfuse {
  if (!_langfuse) {
    _langfuse = new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    });
  }
  return _langfuse;
}

export function resetLangfuse(): void {
  _langfuse = null;
}
