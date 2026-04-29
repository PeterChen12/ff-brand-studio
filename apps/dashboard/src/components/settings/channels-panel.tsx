"use client";

/**
 * Issue 6 — marketplace channels placeholder.
 *
 * Auto-publish to Amazon Seller Central / Shopify Admin API isn't on
 * the v2 roadmap; ADR-0001 stops at asset generation. Until enterprise
 * integration ships, this panel surfaces the state honestly: each
 * channel card is locked, marked "Enterprise feature", and routes to
 * a Calendly booking link to scope the integration.
 *
 * Operators on the self-serve plan still get the Amazon/Shopify
 * OUTPUTS (compliance-shaped image slots + SEO copy in the right
 * language) — those are produced from the launch wizard and downloaded
 * as a ZIP. The wizard surfaces a small inline note pointing here.
 */

import {
  Card,
  CardContent,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CALENDLY_URL = "https://calendar.app.google/SKMgxvqGGoCbSZut8";

interface ChannelDef {
  id: "amazon" | "shopify";
  name: string;
  nameZh: string;
  blurb: string;
  bullets: string[];
}

const CHANNELS: ChannelDef[] = [
  {
    id: "amazon",
    name: "Amazon Seller Central",
    nameZh: "亚马逊卖家中心",
    blurb:
      "Push generated assets + listings directly to your Amazon US catalog via SP-API.",
    bullets: [
      "OAuth via Login With Amazon (LWA)",
      "Auto-upload to the 7 main-image slots + A+ Content modules",
      "Bilingual metadata sync · last-known-good rollback on policy reject",
    ],
  },
  {
    id: "shopify",
    name: "Shopify Store",
    nameZh: "Shopify 店铺",
    blurb:
      "One-click product create + image set push to your Shopify storefront.",
    bullets: [
      "OAuth via Shopify Partner app",
      "Hero, lifestyle, and detail images mapped to Shopify product gallery",
      "SKU + variant metadata round-trip · webhook-driven inventory sync",
    ],
  },
];

export function ChannelsPanel() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Channels · 销售渠道</CardEyebrow>
            <CardTitle className="mt-1.5">Marketplace integrations</CardTitle>
          </div>
          <Badge variant="neutral" size="sm">
            Enterprise
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="md-typescale-body-medium text-on-surface-variant">
            Self-serve plan generates the Amazon-shaped + Shopify-shaped
            outputs — image slots and listings in the right format, ready
            to download from <a className="text-primary underline" href="/launch">Launch SKU</a> or
            the <a className="text-primary underline" href="/library">Library</a>.
            Auto-publish (push assets + listings to your account directly)
            is part of the Enterprise tier; book a call below to scope
            integration for your org.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CHANNELS.map((channel) => (
          <Card key={channel.id} className="opacity-95">
            <CardHeader>
              <div>
                <CardEyebrow className="text-on-surface-variant">
                  {channel.nameZh}
                </CardEyebrow>
                <CardTitle className="mt-1.5">{channel.name}</CardTitle>
              </div>
              <Badge variant="neutral" size="sm">
                Not connected
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="md-typescale-body-medium text-on-surface-variant">
                {channel.blurb}
              </p>
              <ul className="md-typescale-body-small text-on-surface-variant/80 space-y-1.5 font-mono">
                {channel.bullets.map((b) => (
                  <li key={b}>· {b}</li>
                ))}
              </ul>
              <div className="pt-3 border-t ff-hairline flex items-center gap-3">
                <button
                  type="button"
                  disabled
                  className="h-9 px-4 rounded-m3-full bg-surface-container border ff-hairline md-typescale-label-medium text-on-surface-variant/60 cursor-not-allowed"
                  title="Auto-publish requires Enterprise integration"
                >
                  Connect — Enterprise feature
                </button>
                <a
                  href={CALENDLY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-9 px-4 rounded-m3-full bg-primary text-primary-on shadow-m3-1 md-typescale-label-medium inline-flex items-center hover:shadow-m3-2 transition-shadow"
                >
                  Schedule onboarding call →
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>What's working today</CardEyebrow>
            <CardTitle className="mt-1.5">Local export path</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="md-typescale-body-medium text-on-surface-variant space-y-2 list-decimal list-inside">
            <li>
              Launch a SKU from{" "}
              <a className="text-primary underline" href="/launch">
                Launch SKU
              </a>
              . Pick Amazon, Shopify, or both — these drive which
              compliance-shaped image slots and which SEO copy languages
              get produced.
            </li>
            <li>
              On success, the result panel surfaces a "Download bundle"
              button. The ZIP includes every generated image plus a
              <code className="font-mono mx-1 px-1.5 py-0.5 bg-surface-container-low rounded-m3-sm text-[0.6875rem]">
                manifest.csv
              </code>
              so you (or your VA) can hand-upload to Seller Central and
              Shopify Admin.
            </li>
            <li>
              The Library tab keeps the full asset catalog with
              per-asset and per-SKU bundle downloads — useful for
              re-issuing assets to a different listing.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
