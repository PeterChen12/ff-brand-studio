"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import { useApiQuery } from "@/lib/api-query";
import { formatTimestamp } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  createdBy: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function ApiKeysPanel() {
  const apiFetch = useApiFetch();
  const now = useNow();
  const { data, error, isLoading, mutate } = useApiQuery<{ keys: ApiKey[] }>(
    "/v1/api-keys"
  );
  const keys = data?.keys ?? null;

  const [issued, setIssued] = useState<{
    key: string;
    name: string;
    prefix: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ApiKey | null>(null);
  const [name, setName] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const d = await apiFetch<{ key: string; prefix: string; name: string }>(
        "/v1/api-keys",
        { method: "POST", body: JSON.stringify({ name: name.trim() }) }
      );
      setIssued({ key: d.key, prefix: d.prefix, name: d.name });
      setName("");
      toast.success(`Issued '${d.name}' — copy the key now, it won't be shown again.`);
      await mutate();
    } catch (e) {
      toast.error(
        e instanceof Error ? `Couldn't issue key — ${e.message}` : "Couldn't issue key"
      );
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await apiFetch(`/v1/api-keys/${id}`, { method: "DELETE" });
      toast.success("Key revoked.");
      await mutate();
    } catch (e) {
      toast.error(
        e instanceof Error ? `Couldn't revoke — ${e.message}` : "Couldn't revoke"
      );
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Issue · 颁发</CardEyebrow>
            <CardTitle className="mt-1.5">Create a new key</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex flex-wrap gap-3 items-start">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="agency CI · scheduled launches · etc."
              maxLength={80}
              className="flex-1 min-w-[280px] h-10 px-4 rounded-m3-md bg-surface-container-low border ff-hairline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <button
              type="submit"
              disabled={creating || name.trim().length === 0}
              className="h-10 px-6 rounded-m3-full bg-primary text-primary-on md-typescale-label-large shadow-m3-1 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {creating ? "Issuing…" : "Issue key"}
            </button>
          </form>
          <p className="md-typescale-body-small text-on-surface-variant mt-3">
            Keys grant the same access as your dashboard session. Use as
            <code className="mx-1.5 px-1.5 py-0.5 rounded-m3-sm bg-surface-container font-mono text-[0.75rem]">
              Authorization: Bearer ff_live_*
            </code>
            when calling the API.
          </p>
        </CardContent>
      </Card>

      {issued && (
        <Card className="border-tertiary border">
          <CardHeader>
            <div>
              <CardEyebrow className="text-tertiary">
                Save now · 仅显示一次
              </CardEyebrow>
              <CardTitle className="mt-1.5">Your new key</CardTitle>
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
              <strong>{issued.name}</strong> · prefix{" "}
              <span className="font-mono text-[0.75rem]">{issued.prefix}</span>
            </div>
            <div className="rounded-m3-md bg-surface-container px-4 py-3 font-mono text-[0.8125rem] break-all flex items-center gap-3">
              <span className="flex-1">{issued.key}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(issued.key);
                  toast.success("Copied to clipboard.");
                }}
                className="px-3 h-8 rounded-m3-full bg-primary text-primary-on md-typescale-label-medium shrink-0"
              >
                Copy
              </button>
            </div>
            <p className="md-typescale-body-small text-on-surface-variant mt-3">
              We don't store the secret part — once you close this card the
              full key is gone. Save it in your secret manager (1Password,
              AWS Secrets Manager, etc.) before navigating away.
            </p>
            <div className="mt-4">
              <CardEyebrow>Quick test</CardEyebrow>
              <pre className="rounded-m3-md bg-surface-container px-4 py-3 mt-2 overflow-x-auto md-typescale-body-small font-mono text-[0.75rem] leading-relaxed">{`curl -H "Authorization: Bearer ${issued.key}" \\
     https://ff-brand-studio-mcp.creatorain.workers.dev/v1/products`}</pre>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Existing keys · 现有</CardEyebrow>
            <CardTitle className="mt-1.5">
              {isLoading
                ? "Loading…"
                : keys
                  ? `${keys.length} key${keys.length === 1 ? "" : "s"}`
                  : "—"}
            </CardTitle>
          </div>
        </CardHeader>
        {error ? (
          <div className="px-6 pb-6">
            <ErrorState
              title="Couldn't load API keys"
              error={error}
              onRetry={() => mutate()}
            />
          </div>
        ) : isLoading ? (
          <div className="px-6 pb-6 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : keys && keys.length === 0 ? (
          <div className="px-6 pb-6 md-typescale-body-medium text-on-surface-variant">
            No keys yet. Issue one above.
          </div>
        ) : keys ? (
          <div className="px-6 pb-6 overflow-x-auto -mx-6 px-6">
            <table className="w-full text-left">
              <thead>
                <tr className="md-typescale-label-small text-on-surface-variant">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Prefix</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Last used</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr
                    key={k.id}
                    className="border-t ff-hairline md-typescale-body-medium"
                  >
                    <td className="py-3 pr-3 max-w-[20ch] truncate" title={k.name}>
                      {k.name}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[0.75rem]">
                      {k.prefix}…
                    </td>
                    <td className="py-3 pr-3 text-on-surface-variant whitespace-nowrap">
                      {formatTimestamp(k.createdAt, "short", now)}
                    </td>
                    <td className="py-3 pr-3 text-on-surface-variant whitespace-nowrap">
                      {k.lastUsedAt
                        ? formatTimestamp(k.lastUsedAt, "relative", now)
                        : "never"}
                    </td>
                    <td className="py-3 pr-3">
                      {k.revokedAt ? (
                        <Badge variant="flagged" size="sm">
                          revoked
                        </Badge>
                      ) : (
                        <Badge variant="passed" size="sm">
                          active
                        </Badge>
                      )}
                    </td>
                    <td className="py-3">
                      {!k.revokedAt && (
                        <button
                          type="button"
                          onClick={() => setConfirmTarget(k)}
                          disabled={revoking === k.id}
                          className="px-3 h-7 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium text-error hover:bg-error/5 focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
                        >
                          {revoking === k.id ? "Revoking…" : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={`Revoke "${confirmTarget?.name ?? ""}"?`}
        description="The key stops working immediately — anyone using it will start getting 401 on the next request. This cannot be undone."
        confirmLabel="Revoke key"
        destructive
        busy={revoking !== null}
        onConfirm={async () => {
          if (confirmTarget) {
            await revoke(confirmTarget.id);
            setConfirmTarget(null);
          }
        }}
      />
    </div>
  );
}
