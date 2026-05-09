"use client";

/**
 * Phase N — settings shell.
 *
 * Three tabs (api-keys / webhooks / tenant) bound to URL via
 * `?tab=`. Static export so we can't use App Router parallel
 * routes; the tabs are state + a URL hint via history.replaceState
 * so links are shareable.
 */

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { WebhooksPanel } from "@/components/settings/webhooks-panel";
import { TenantPanel } from "@/components/settings/tenant-panel";
import { ChannelsPanel } from "@/components/settings/channels-panel";

type Tab = "api-keys" | "webhooks" | "tenant" | "channels" | "advanced";

// Phase C · Iteration 05 — vocabulary sweep. "Tenant" is real-estate
// jargon; renamed to "Brand profile". "API keys" + "Webhooks" are
// developer surfaces — folded under a single "Advanced" tab so a
// non-technical marketer doesn't see two tabs they don't understand.
const TABS: { id: Tab; label: string; sub: string; description: string }[] = [
  {
    id: "channels",
    label: "Channels",
    sub: "销售渠道",
    description: "Where your listings get published",
  },
  {
    id: "tenant",
    label: "Brand profile",
    sub: "品牌资料",
    description: "Defaults applied to every new listing",
  },
  {
    id: "advanced",
    label: "Advanced",
    sub: "开发者",
    description: "Developer integrations — API keys & webhooks",
  },
];

function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "channels";
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("tab");
  if (
    t === "webhooks" ||
    t === "tenant" ||
    t === "api-keys" ||
    t === "channels" ||
    t === "advanced"
  ) {
    return t;
  }
  return "channels";
}

function writeTabToUrl(tab: Tab) {
  if (typeof window === "undefined") return;
  const url = tab === "channels"
    ? window.location.pathname
    : `${window.location.pathname}?tab=${tab}`;
  window.history.replaceState({}, "", url);
}

export default function SettingsClient() {
  const [tab, setTab] = useState<Tab>("channels");

  useEffect(() => {
    setTab(readTabFromUrl());
  }, []);

  useEffect(() => {
    writeTabToUrl(tab);
  }, [tab]);

  return (
    <>
      <PageHeader
        eyebrow="Settings · 设置"
        title="Account, integrations, branding"
        description="Issue API keys, subscribe to webhooks, customize how generated assets carry your brand."
      />

      <section className="px-6 md:px-12 pt-8 pb-12 max-w-5xl mx-auto">
        <div role="tablist" className="flex items-center gap-1 border-b ff-hairline">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={[
                "h-10 px-4 md-typescale-label-large border-b-2 -mb-px transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-m3-sm",
                tab === t.id
                  ? "border-primary text-on-surface"
                  : "border-transparent text-on-surface-variant hover:text-on-surface",
              ].join(" ")}
            >
              {t.label}
              <span className="ml-2 md-typescale-body-small text-on-surface-variant/60">
                {t.sub}
              </span>
            </button>
          ))}
        </div>
        {/* Phase C · Iter 08 — one-line tab description so a marketer knows
            what's in each tab before clicking around. */}
        <p className="md-typescale-body-small text-on-surface-variant mt-3 mb-6">
          {TABS.find((t) => t.id === tab)?.description ?? ""}
        </p>

        {tab === "channels" && <ChannelsPanel />}
        {tab === "tenant" && <TenantPanel />}
        {tab === "advanced" && (
          <div className="space-y-10">
            <ApiKeysPanel />
            <WebhooksPanel />
          </div>
        )}
        {/* Direct-URL access still works for power users who bookmarked the old tabs. */}
        {tab === "api-keys" && <ApiKeysPanel />}
        {tab === "webhooks" && <WebhooksPanel />}
      </section>
    </>
  );
}
