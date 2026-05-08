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
import { CALENDLY_URL, ENTERPRISE_BLURB_EN } from "@/lib/enterprise";
import { useTenant } from "@/lib/tenant-context";

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
  const tenant = useTenant();
  // Single source of truth for enterprise gating: tenants.plan column
  // (open question 3 in PHASE_B_ITERATION.md, resolved to use plan).
  // Self-serve and starter plans see the consolidated booking card;
  // enterprise plans see the actual integration cards (currently still
  // "Coming soon" — Phase B-2 wires real OAuth).
  const isEnterprise = tenant?.plan === "enterprise";

  return (
    <div className="space-y-6">
      {/* Primary CTA — single unified "Set up enterprise account ·
          Schedule onboarding" booking card. Replaces the previous
          intro card + per-channel disabled buttons + footer link
          (3 separate Calendly entry points → 1). */}
      {!isEnterprise ? (
        <Card>
          <CardHeader>
            <div>
              <CardEyebrow>Channels · 销售渠道</CardEyebrow>
              <CardTitle className="mt-1.5">
                Set up enterprise account
              </CardTitle>
            </div>
            <Badge variant="neutral" size="sm">
              Enterprise
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="md-typescale-body-medium text-on-surface-variant">
              {ENTERPRISE_BLURB_EN}
            </p>
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-5 rounded-m3-full bg-primary text-primary-on shadow-m3-1 md-typescale-label-large inline-flex items-center hover:shadow-m3-2 transition-shadow"
            >
              Schedule onboarding call →
            </a>
            <p className="md-typescale-body-small text-on-surface-variant/70">
              In-person meetings welcome — let us know in the booking
              notes and we'll come to your office.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardEyebrow>Channels · 销售渠道</CardEyebrow>
              <CardTitle className="mt-1.5">
                Marketplace integrations
              </CardTitle>
            </div>
            <Badge variant="neutral" size="sm">
              Enterprise · active
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="md-typescale-body-medium text-on-surface-variant">
              Connect your Seller Central or Shopify account and approved
              assets auto-publish from the operator inbox.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Per-marketplace cards — visible only to enterprise tenants.
          Self-serve plans don't see locked OAuth flows because they
          don't exist (Phase B-2). For now even enterprise tenants see
          "Coming soon" until a real adapter ships. */}
      {isEnterprise && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {CHANNELS.map((channel) => (
            <Card key={channel.id}>
              <CardHeader>
                <div>
                  <CardEyebrow className="text-on-surface-variant">
                    {channel.nameZh}
                  </CardEyebrow>
                  <CardTitle className="mt-1.5">{channel.name}</CardTitle>
                </div>
                <Badge variant="neutral" size="sm">
                  Coming soon
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
                <p className="md-typescale-body-small text-on-surface-variant/70 pt-3 border-t ff-hairline">
                  Operator-provisioned today via secure credential vault.
                  Self-serve OAuth ships in Phase B-2.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
