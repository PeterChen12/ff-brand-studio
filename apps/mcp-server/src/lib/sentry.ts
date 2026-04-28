/**
 * Phase M3 — minimal Sentry envelope sender for Workers.
 *
 * No-op when SENTRY_DSN is unset. Avoids the full @sentry/node SDK
 * (Node-only) — sends a single JSON envelope to Sentry's ingest URL.
 *
 * Use captureError(env, err, ctx) at the catch sites where we currently
 * console.error. The console.error stays — Sentry is additive, not
 * replacement, so logs in `wrangler tail` stay useful.
 */

interface CaptureContext {
  /** Hono path (e.g. "/v1/launches"). */
  route?: string;
  /** Tenant id when known. */
  tenantId?: string;
  /** Hono actor when known. */
  actor?: string;
  /** Free-form tags. */
  tags?: Record<string, string>;
}

function parseDsn(dsn: string): { url: string; key: string; projectId: string } | null {
  // DSN: https://<public_key>@<host>/<project_id>
  try {
    const u = new URL(dsn);
    const key = u.username;
    const projectId = u.pathname.replace(/^\//, "");
    const url = `${u.protocol}//${u.host}/api/${projectId}/envelope/`;
    return { url, key, projectId };
  } catch {
    return null;
  }
}

export async function captureError(
  env: CloudflareBindings,
  err: unknown,
  ctx: CaptureContext = {}
): Promise<void> {
  if (!env.SENTRY_DSN) return;
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return;

  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? "" : "";

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const ts = new Date().toISOString();
  const event = {
    event_id: eventId,
    timestamp: ts,
    level: "error",
    platform: "javascript",
    server_name: "ff-brand-studio-mcp",
    environment: env.ENVIRONMENT ?? "production",
    tags: {
      route: ctx.route,
      ...ctx.tags,
    },
    user: ctx.tenantId
      ? { id: ctx.tenantId, username: ctx.actor }
      : undefined,
    exception: {
      values: [
        {
          type: err instanceof Error ? err.name : "Error",
          value: message,
          stacktrace: stack ? { frames: parseStack(stack) } : undefined,
        },
      ],
    },
  };

  const headerLine = JSON.stringify({
    event_id: eventId,
    sent_at: ts,
    dsn: env.SENTRY_DSN,
  });
  const itemHeader = JSON.stringify({ type: "event" });
  const itemPayload = JSON.stringify(event);
  const envelope = `${headerLine}\n${itemHeader}\n${itemPayload}\n`;

  try {
    await fetch(dsn.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7,sentry_key=${dsn.key},sentry_client=ff-brand-studio/0.1`,
      },
      body: envelope,
      signal: AbortSignal.timeout(5000),
    });
  } catch (sentryErr) {
    console.warn("[sentry] envelope send failed:", sentryErr);
  }
}

function parseStack(stack: string): Array<{ filename: string; lineno: number; colno: number; function: string }> {
  const frames: Array<{ filename: string; lineno: number; colno: number; function: string }> = [];
  for (const line of stack.split("\n").slice(1, 11)) {
    const m = line.match(/^\s*at\s+(.+?)\s+\(?(.+?):(\d+):(\d+)\)?$/);
    if (m) {
      frames.push({
        function: m[1],
        filename: m[2],
        lineno: parseInt(m[3], 10),
        colno: parseInt(m[4], 10),
      });
    }
  }
  return frames.reverse(); // Sentry expects oldest-first
}
