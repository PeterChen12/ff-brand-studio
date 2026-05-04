"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Subscription {
  id: string;
  url: string;
  events: string[];
  createdAt: string | null;
  disabledAt: string | null;
}

const ALL_EVENTS = [
  "launch.complete",
  "launch.failed",
  "listing.publish",
  "listing.unpublish",
  "billing.stripe_topup",
] as const;

export function WebhooksPanel() {
  const apiFetch = useApiFetch();
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [issued, setIssued] = useState<{ id: string; secret: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([...ALL_EVENTS]);
  const [confirmTarget, setConfirmTarget] = useState<Subscription | null>(null);
  const [disabling, setDisabling] = useState<string | null>(null);

  async function refresh() {
    try {
      const d = await apiFetch<{ subscriptions: Subscription[] }>("/v1/webhooks");
      setSubs(d.subscriptions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubs([]);
    }
  }

  useEffect(() => {
    refresh();
  }, [apiFetch]);

  function toggleEvent(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || events.length === 0) return;
    try {
      new URL(url.trim());
    } catch {
      setError("Receiver URL is not a valid URL");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const d = await apiFetch<{
        subscription: { id: string; url: string };
        secret: string;
      }>("/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: url.trim(), events }),
      });
      setIssued({ id: d.subscription.id, secret: d.secret, url: d.subscription.url });
      setUrl("");
      setEvents([...ALL_EVENTS]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function disable(id: string) {
    setDisabling(id);
    try {
      await apiFetch(`/v1/webhooks/${id}`, { method: "DELETE" });
      toast.success("Webhook disabled.");
      await refresh();
    } catch (e) {
      toast.error(
        e instanceof Error ? `Couldn't disable — ${e.message}` : "Couldn't disable"
      );
    } finally {
      setDisabling(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Subscribe · 订阅</CardEyebrow>
            <CardTitle className="mt-1.5">Add a webhook receiver</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="md-typescale-label-medium block mb-1.5">Receiver URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-receiver.example.com/ff-events"
                className="w-full h-10 px-4 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="md-typescale-label-medium block mb-1.5">Events</label>
              <div className="flex flex-wrap gap-2">
                {ALL_EVENTS.map((ev) => (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => toggleEvent(ev)}
                    className={[
                      "h-8 px-3 rounded-m3-full md-typescale-label-medium border ff-hairline transition-colors font-mono text-[0.75rem]",
                      events.includes(ev)
                        ? "bg-primary text-primary-on border-transparent"
                        : "bg-surface-container hover:bg-surface-container-high",
                    ].join(" ")}
                  >
                    {events.includes(ev) ? "✓ " : ""}{ev}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={creating || url.trim() === "" || events.length === 0}
              className="h-10 px-6 rounded-m3-full bg-primary text-primary-on md-typescale-label-large shadow-m3-1 disabled:opacity-50"
            >
              {creating ? "Subscribing…" : "Subscribe"}
            </button>
            {error && <div className="md-typescale-body-medium text-error">{error}</div>}
          </form>
        </CardContent>
      </Card>

      {issued && (
        <Card className="border-tertiary border">
          <CardHeader>
            <div>
              <CardEyebrow className="text-tertiary">Save now · 仅显示一次</CardEyebrow>
              <CardTitle className="mt-1.5">Webhook signing secret</CardTitle>
            </div>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="px-3 h-8 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium"
            >
              I've saved it
            </button>
          </CardHeader>
          <CardContent>
            <div className="md-typescale-body-medium text-on-surface mb-2">
              {issued.url}
            </div>
            <div className="rounded-m3-md bg-surface-container px-4 py-3 font-mono text-[0.8125rem] break-all flex items-center gap-3">
              <span className="flex-1">{issued.secret}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(issued.secret)}
                className="px-3 h-8 rounded-m3-full bg-primary text-primary-on md-typescale-label-medium shrink-0"
              >
                Copy
              </button>
            </div>
            <p className="md-typescale-body-small text-on-surface-variant mt-3">
              Verify each delivery with HMAC-SHA256 over <code className="font-mono">{`${"\\${ts}.${body}"}`}</code> against this
              secret. The header arrives as
              <code className="mx-1.5 font-mono text-[0.75rem]">X-FF-Signature: t=&lt;ts&gt;,v1=&lt;hex&gt;</code>
              (Stripe pattern).
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Active subscriptions · 已激活</CardEyebrow>
            <CardTitle className="mt-1.5">
              {subs === null ? "Loading…" : `${subs.length} subscription${subs.length === 1 ? "" : "s"}`}
            </CardTitle>
          </div>
        </CardHeader>
        {subs === null ? (
          <div className="px-6 pb-6 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : subs.length === 0 ? (
          <div className="px-6 pb-6 md-typescale-body-medium text-on-surface-variant">
            No webhook subscriptions yet.
          </div>
        ) : (
          <div className="px-6 pb-6 space-y-2">
            {subs.map((s) => (
              <div
                key={s.id}
                className="rounded-m3-md md-surface-container-low border ff-hairline px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="md-typescale-body-medium font-mono text-[0.8125rem] truncate">
                    {s.url}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {s.events.map((ev) => (
                      <span key={ev} className="px-2 py-0.5 rounded-m3-sm bg-surface-container md-typescale-body-small font-mono text-[0.6875rem]">
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.disabledAt ? (
                    <Badge variant="flagged" size="sm">disabled</Badge>
                  ) : (
                    <Badge variant="passed" size="sm">active</Badge>
                  )}
                  {!s.disabledAt && (
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(s)}
                      disabled={disabling === s.id}
                      className="px-3 h-7 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium text-error hover:bg-error/5 focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
                    >
                      {disabling === s.id ? "Disabling…" : "Disable"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title="Disable this webhook?"
        description={`Stop sending events to ${confirmTarget?.url ?? ""}. Existing failed deliveries stop retrying. This cannot be undone.`}
        confirmLabel="Disable"
        destructive
        busy={disabling !== null}
        onConfirm={async () => {
          if (confirmTarget) {
            await disable(confirmTarget.id);
            setConfirmTarget(null);
          }
        }}
      />
    </div>
  );
}
