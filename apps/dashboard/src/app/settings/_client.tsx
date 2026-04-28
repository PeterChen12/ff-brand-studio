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

type Tab = "api-keys" | "webhooks" | "tenant";

const TABS: { id: Tab; label: string; sub: string }[] = [
  { id: "api-keys", label: "API keys", sub: "密钥" },
  { id: "webhooks", label: "Webhooks", sub: "事件订阅" },
  { id: "tenant", label: "Tenant", sub: "租户配置" },
];

function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "api-keys";
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("tab");
  if (t === "webhooks" || t === "tenant") return t;
  return "api-keys";
}

function writeTabToUrl(tab: Tab) {
  if (typeof window === "undefined") return;
  const url = tab === "api-keys"
    ? window.location.pathname
    : `${window.location.pathname}?tab=${tab}`;
  window.history.replaceState({}, "", url);
}

export default function SettingsClient() {
  const [tab, setTab] = useState<Tab>("api-keys");

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
        <div role="tablist" className="flex items-center gap-1 mb-6 border-b ff-hairline">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={[
                "h-10 px-4 md-typescale-label-large border-b-2 -mb-px transition-colors",
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

        {tab === "api-keys" && <ApiKeysPanel />}
        {tab === "webhooks" && <WebhooksPanel />}
        {tab === "tenant" && <TenantPanel />}
      </section>
    </>
  );
}
