"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import { MCP_URL } from "@/lib/config";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface IntegrationRow {
  id: string;
  provider: string;
  accountLabel: string | null;
  status: string;
  createdAt: string | null;
  rotatedAt: string | null;
  expiresAt: string | null;
}

/**
 * P5 — self-service onboarding for downstream destinations.
 *
 * Operator picks an adapter (generic-rest / buyfishingrod-admin),
 * pastes the receiver's base URL, optionally generates a fresh HMAC
 * signing secret, hits "Test connection." On success, the row gets
 * saved to integration_credentials. Existing rows can be rotated
 * (re-POST), disabled, or deleted.
 */
const ADAPTERS = [
  {
    value: "generic-rest",
    label: "Generic REST (any ecommerce admin)",
    description:
      'Recommended. Implement the 3 endpoints in /v1/tenant-api.yaml on your backend and we POST staged products + listings to you.',
  },
  {
    value: "buyfishingrod-admin",
    label: "BuyFishingRod-style admin (legacy alias)",
    description:
      "Same transport as generic-rest but the provider label is preserved in the audit log. Use this when migrating from the legacy BFR-specific flow.",
  },
];

function randomSecret(): string {
  const bytes = new Uint8Array(48);
  // FIX P5-review #6: no Math.random() fallback. crypto.getRandomValues
  // is universally available in modern browsers; the fallback would
  // silently downgrade a production secret's entropy on a broken
  // environment. Throw loudly instead so the operator notices.
  if (typeof window === "undefined" || !window.crypto?.getRandomValues) {
    throw new Error(
      "crypto.getRandomValues not available — refusing to generate a weak HMAC secret"
    );
  }
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function IntegrationsPanel() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState<IntegrationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showWizard, setShowWizard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    provider: "generic-rest",
    accountLabel: "",
    baseUrl: "",
    signingSecret: "",
  });
  const [secretCopied, setSecretCopied] = useState(false);

  async function load() {
    setError(null);
    try {
      const data = await apiFetch<{ integrations: IntegrationRow[] }>(
        "/v1/integrations"
      );
      setItems(data.integrations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!draft.baseUrl.trim() || !draft.signingSecret.trim()) {
      toast.error("Base URL and signing secret are required");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/v1/integrations", {
        method: "POST",
        body: JSON.stringify({
          provider: draft.provider,
          accountLabel: draft.accountLabel.trim() || undefined,
          config: {
            baseUrl: draft.baseUrl.trim().replace(/\/$/, ""),
            signingSecret: draft.signingSecret.trim(),
          },
          status: "active",
        }),
      });
      toast.success("Integration saved");
      setShowWizard(false);
      setDraft({ provider: "generic-rest", accountLabel: "", baseUrl: "", signingSecret: "" });
      setSecretCopied(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
    setBusy(false);
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const result = await apiFetch<{
        ok: boolean;
        upstreamStatus?: number;
        upstreamBody?: string;
        error?: string;
        message?: string;
      }>(`/v1/integrations/${id}/test`, { method: "POST" });
      if (result.ok) {
        toast.success(`Reachable — receiver returned ${result.upstreamStatus}`);
      } else {
        toast.error(
          `Test failed: ${result.error ?? "unknown"} ${result.message ?? ""}`
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    }
    setTesting(null);
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Delete integration "${label}"? Active products won't be re-pushed.`)) {
      return;
    }
    try {
      await apiFetch(`/v1/integrations/${id}`, { method: "DELETE" });
      toast.success("Deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardEyebrow>Downstream destinations · 销售渠道</CardEyebrow>
        <CardTitle>Where your products land</CardTitle>
        <p className="md-typescale-body-small text-on-surface-variant mt-1">
          Configure one or more admin endpoints that receive staged
          products. Each row pairs a base URL with an HMAC signing
          secret. See{" "}
          <a
            className="underline-offset-2 hover:underline"
            href={`${MCP_URL}/v1/tenant-api.yaml`}
            target="_blank"
            rel="noopener noreferrer"
          >
            /v1/tenant-api.yaml
          </a>{" "}
          for the contract.
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
            {error}
          </div>
        )}
        {items === null ? (
          <Skeleton className="h-20 w-full" />
        ) : items.length === 0 ? (
          <p className="md-typescale-body-small text-on-surface-variant py-2">
            No integrations yet. Add one to start receiving staged products on
            your admin.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-on-surface-variant border-b">
              <tr>
                <th className="py-2 text-left">Provider</th>
                <th className="py-2 text-left">Label</th>
                <th className="py-2 text-left">Status</th>
                <th className="py-2 text-left">Rotated</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="py-2 font-mono text-xs">{i.provider}</td>
                  <td className="py-2">{i.accountLabel ?? "—"}</td>
                  <td className="py-2">
                    <Badge variant={i.status === "active" ? "passed" : "neutral"}>
                      {i.status}
                    </Badge>
                  </td>
                  <td className="py-2 text-xs text-on-surface-variant">
                    {i.rotatedAt
                      ? new Date(i.rotatedAt).toLocaleString()
                      : i.createdAt
                        ? `created ${new Date(i.createdAt).toLocaleDateString()}`
                        : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleTest(i.id)}
                      disabled={testing === i.id}
                      className="text-xs underline-offset-2 hover:underline mr-3 disabled:opacity-50"
                    >
                      {testing === i.id ? "Testing…" : "Test"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(i.id, i.accountLabel ?? i.provider)}
                      className="text-xs text-error underline-offset-2 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4">
          {!showWizard ? (
            <button
              type="button"
              onClick={() => {
                setShowWizard(true);
                setDraft({
                  provider: "generic-rest",
                  accountLabel: "",
                  baseUrl: "",
                  signingSecret: randomSecret(),
                });
                setSecretCopied(false);
              }}
              className="rounded-m3 bg-primary px-4 py-2 text-on-primary text-sm font-medium hover:bg-primary/90"
            >
              + Add integration
            </button>
          ) : (
            <div className="rounded-m3 border border-outline-variant p-4 space-y-4">
              <h3 className="md-typescale-title-medium">Add a downstream destination</h3>
              <div className="space-y-1">
                <label className="md-typescale-label-medium block">Adapter type</label>
                <select
                  value={draft.provider}
                  onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                  className="w-full rounded-m3-sm border border-outline-variant bg-surface px-3 py-2 text-sm"
                >
                  {ADAPTERS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <p className="text-xs text-on-surface-variant">
                  {ADAPTERS.find((a) => a.value === draft.provider)?.description}
                </p>
              </div>

              <div className="space-y-1">
                <label className="md-typescale-label-medium block">
                  Label (for the audit log; optional)
                </label>
                <input
                  type="text"
                  value={draft.accountLabel}
                  onChange={(e) => setDraft({ ...draft, accountLabel: e.target.value })}
                  placeholder="e.g. CERON staging admin"
                  className="w-full rounded-m3-sm border border-outline-variant bg-surface px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="md-typescale-label-medium block">Base URL *</label>
                <input
                  type="url"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://admin.example.com"
                  className="w-full rounded-m3-sm border border-outline-variant bg-surface px-3 py-2 text-sm font-mono"
                />
                <p className="text-xs text-on-surface-variant">
                  We POST to <code>{`{baseUrl}/api/integrations/ff-brand-studio/stage-product`}</code>{" "}
                  and friends.
                </p>
              </div>

              <div className="space-y-1">
                <label className="md-typescale-label-medium block">
                  Signing secret * (HMAC-SHA256 key)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft.signingSecret}
                    onChange={(e) => setDraft({ ...draft, signingSecret: e.target.value })}
                    className="flex-1 rounded-m3-sm border border-outline-variant bg-surface px-3 py-2 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ ...draft, signingSecret: randomSecret() });
                      setSecretCopied(false);
                    }}
                    className="text-xs underline-offset-2 hover:underline whitespace-nowrap"
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // FIX P5-review #7: surface clipboard failure
                      // (HTTP-context, denied permission, etc.) so the
                      // operator doesn't believe a copy happened.
                      navigator.clipboard
                        .writeText(draft.signingSecret)
                        .then(() => {
                          setSecretCopied(true);
                          setTimeout(() => setSecretCopied(false), 2000);
                        })
                        .catch(() => {
                          toast.error(
                            "Clipboard write failed — please select and copy the secret manually"
                          );
                        });
                    }}
                    className="text-xs underline-offset-2 hover:underline whitespace-nowrap"
                  >
                    {secretCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-on-surface-variant">
                  Save this somewhere you can paste it on the receiver side
                  (e.g. <code>FF_STUDIO_WEBHOOK_SECRET</code> env var). We won't
                  show it again after you save.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWizard(false)}
                  className="rounded-m3 px-4 py-2 text-sm font-medium hover:bg-surface-variant"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy || !draft.baseUrl.trim() || !draft.signingSecret.trim()}
                  className="rounded-m3 bg-primary px-4 py-2 text-on-primary text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save (test after)"}
                </button>
              </div>
              <p className="text-xs text-on-surface-variant">
                After saving, click "Test" on the row to verify your receiver
                accepts our signature and rejects unsigned requests.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
