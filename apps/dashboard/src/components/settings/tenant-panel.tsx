"use client";

import { useEffect, useState } from "react";
import { useApiFetch, useApiDownload } from "@/lib/api";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface TenantState {
  id: string;
  name: string;
  plan: string;
  features: Record<string, unknown>;
}

interface MeStateResponse {
  tenant: TenantState;
  actor: string | null;
  onboarding: { has_first_product: boolean; has_first_launch: boolean };
}

const DEFAULT_BRAND = "#1C3FAA";

export function TenantPanel() {
  const apiFetch = useApiFetch();
  const apiDownload = useApiDownload();
  const [tenant, setTenant] = useState<TenantState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [brandHex, setBrandHex] = useState(DEFAULT_BRAND);
  const [defaultPlatforms, setDefaultPlatforms] = useState<string[]>(["amazon", "shopify"]);
  const [amazonAPlusGrid, setAmazonAPlusGrid] = useState(false);
  const [rateLimit, setRateLimit] = useState<string>("");

  useEffect(() => {
    apiFetch<MeStateResponse>("/v1/me/state")
      .then((d) => {
        setTenant(d.tenant);
        const f = d.tenant.features ?? {};
        if (typeof f.brand_hex === "string" && /^#[0-9a-fA-F]{6}$/.test(f.brand_hex)) {
          setBrandHex(f.brand_hex);
        }
        if (Array.isArray(f.default_platforms)) {
          setDefaultPlatforms(f.default_platforms.map(String));
        }
        if (typeof f.amazon_a_plus_grid === "boolean") setAmazonAPlusGrid(f.amazon_a_plus_grid);
        if (typeof f.rate_limit_per_min === "number") setRateLimit(String(f.rate_limit_per_min));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [apiFetch]);

  function togglePlatform(p: string) {
    setDefaultPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const patch: Record<string, unknown> = {
        brand_hex: brandHex,
        default_platforms: defaultPlatforms,
        amazon_a_plus_grid: amazonAPlusGrid,
      };
      if (rateLimit.trim()) {
        const n = parseInt(rateLimit.trim(), 10);
        if (Number.isFinite(n)) patch.rate_limit_per_min = n;
      }
      const d = await apiFetch<{ tenant: TenantState }>("/v1/tenant", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setTenant(d.tenant);
      setSuccess("Saved.");
      setTimeout(() => setSuccess(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (tenant === null) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Loading…</CardEyebrow>
            <CardTitle className="mt-1.5">Tenant</CardTitle>
          </div>
        </CardHeader>
        <div className="px-6 pb-6 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Card>
    );
  }

  const features = tenant.features ?? {};

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Identity · 身份</CardEyebrow>
            <CardTitle className="mt-1.5">{tenant.name}</CardTitle>
          </div>
          <Badge variant="neutral" size="sm">
            {tenant.plan}
          </Badge>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-2 md-typescale-body-medium">
            <dt className="text-on-surface-variant">Tenant ID</dt>
            <dd className="font-mono text-[0.75rem]">{tenant.id}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Branding · 品牌</CardEyebrow>
            <CardTitle className="mt-1.5">Composite + banner accent</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <label className="md-typescale-label-medium block mb-2">Brand color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandHex}
                onChange={(e) => setBrandHex(e.target.value)}
                className="h-10 w-16 rounded-m3-md cursor-pointer border ff-hairline"
              />
              <input
                type="text"
                value={brandHex}
                onChange={(e) => setBrandHex(e.target.value)}
                pattern="^#[0-9a-fA-F]{6}$"
                className="w-36 h-10 px-3 rounded-m3-md bg-surface-container-low border ff-hairline font-mono"
              />
              <span className="md-typescale-body-small text-on-surface-variant">
                Used in spec composites + Shopify banner gradient
              </span>
            </div>
          </div>

          <div>
            <label className="md-typescale-label-medium block mb-2">Default launch platforms</label>
            <div className="flex gap-2">
              {(["amazon", "shopify"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={[
                    "h-9 px-4 rounded-m3-full md-typescale-label-medium border ff-hairline transition-colors",
                    defaultPlatforms.includes(p)
                      ? "bg-primary text-primary-on border-transparent"
                      : "bg-surface-container hover:bg-surface-container-high",
                  ].join(" ")}
                >
                  {defaultPlatforms.includes(p) ? "✓ " : ""}{p}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="amazon-a-plus-grid"
              checked={amazonAPlusGrid}
              onChange={(e) => setAmazonAPlusGrid(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="amazon-a-plus-grid" className="md-typescale-body-medium cursor-pointer">
              Add Amazon A+ comparison grid slot
              <span className="block md-typescale-body-small text-on-surface-variant">
                Adds the optional 7th Amazon slot — a 2×2 feature grid composite
              </span>
            </label>
          </div>

          <div>
            <label className="md-typescale-label-medium block mb-1.5">Rate limit override (req/min)</label>
            <input
              type="number"
              min={10}
              max={6000}
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              placeholder={`default: ${tenant.plan === "free" ? "60" : tenant.plan === "pro" ? "600" : "1200"}`}
              className="w-40 h-10 px-3 rounded-m3-md bg-surface-container-low border ff-hairline font-mono"
            />
            <span className="md-typescale-body-small text-on-surface-variant block mt-1">
              Leave blank to use the plan default. Activates when Phase M1 Upstash secrets are set on the Worker.
            </span>
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-10 px-6 rounded-m3-full bg-primary text-primary-on md-typescale-label-large shadow-m3-1 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {success && (
              <span className="md-typescale-body-medium text-tertiary">✓ {success}</span>
            )}
            {error && (
              <span className="md-typescale-body-medium text-error">{error}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Operator-only flags · 仅运营</CardEyebrow>
            <CardTitle className="mt-1.5">Read-only · ops-managed</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-2 md-typescale-body-medium">
            <dt className="text-on-surface-variant">production_pipeline</dt>
            <dd>{features.production_pipeline ? "ON" : "off"}</dd>
            <dt className="text-on-surface-variant">feedback_regen</dt>
            <dd>{features.feedback_regen ? "ON" : "off"}</dd>
            <dt className="text-on-surface-variant">has_sample_access</dt>
            <dd>{features.has_sample_access ? "ON" : "off"}</dd>
            <dt className="text-on-surface-variant">max_regens_per_month</dt>
            <dd>{(features.max_regens_per_month as number | undefined) ?? 200}</dd>
          </dl>
          <p className="md-typescale-body-small text-on-surface-variant mt-3">
            These flags are managed by the platform operator. To change them, contact support.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Data export · 导出</CardEyebrow>
            <CardTitle className="mt-1.5">Download every row tagged with this tenant</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="md-typescale-body-medium text-on-surface-variant mb-3">
            ZIP across 12 domain tables — sellers, products, variants, references,
            assets, listings, runs, ledger, audit, api keys, webhook subscriptions,
            and a tenant.json summary.
          </p>
          <ExportButton apiDownload={apiDownload} />
        </CardContent>
      </Card>
    </div>
  );
}

function ExportButton({
  apiDownload,
}: {
  apiDownload: ReturnType<typeof useApiDownload>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function exportNow() {
    setBusy(true);
    setError(null);
    try {
      await apiDownload("/v1/tenant/export", "tenant-export.zip");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={exportNow}
        disabled={busy}
        className="h-10 px-6 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-large hover:bg-surface-container-high disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Download tenant export (ZIP)"}
      </button>
      {error && <span className="md-typescale-body-medium text-error">{error}</span>}
    </div>
  );
}
