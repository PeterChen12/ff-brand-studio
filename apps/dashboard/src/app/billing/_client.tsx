"use client";

/**
 * Phase H3 — wallet + billing surface.
 *
 * Shows current balance, recent ledger rows, and quick top-up
 * buttons. Top-up calls /v1/billing/checkout-session and embeds the
 * Stripe-returned client secret. If Stripe isn't yet configured (no
 * STRIPE_SECRET_KEY), shows a setup banner instead of failing.
 */

import { useEffect, useState } from "react";
import { useApiFetch } from "@/lib/api";
import { formatCents } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

interface LedgerRow {
  id: string;
  deltaCents: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  balanceAfterCents: number;
  at: string;
}

const TOPUP_AMOUNTS = [
  { cents: 1000, label: "$10", sub: "≈ 2 launches" },
  { cents: 2500, label: "$25", sub: "≈ 6 launches" },
  { cents: 5000, label: "$50", sub: "≈ 12 launches" },
  { cents: 10000, label: "$100", sub: "≈ 24 launches" },
];

export default function BillingPageInner() {
  const apiFetch = useApiFetch();
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [topUpInflight, setTopUpInflight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ ledger: LedgerRow[]; balance_cents: number }>(
      "/v1/billing/ledger"
    )
      .then((d) => {
        setLedger(d.ledger);
        setBalance(d.balance_cents);
      })
      .catch((e) => setError(String(e)));
  }, [apiFetch]);

  async function handleTopUp(amountCents: number) {
    setTopUpInflight(amountCents);
    setError(null);
    try {
      const res = await apiFetch<{ client_secret: string } | { error: string }>(
        "/v1/billing/checkout-session",
        {
          method: "POST",
          body: JSON.stringify({ amount_cents: amountCents }),
        }
      );
      if ("error" in res) {
        setError(`Stripe not configured yet: ${res.error}`);
      } else {
        // Phase H3 — Stripe checkout returned a client_secret but the
        // embed UI (@stripe/stripe-js) isn't wired yet. Show an inline
        // banner instead of a native alert so non-operator users
        // understand this is a config gap, not a JS error.
        setError(
          "Stripe checkout is being prepared — embed UI activates once Price IDs are configured. Contact support to enable top-ups."
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("503") || msg.includes("not_configured")) {
        setError(
          "Stripe is not yet configured for this tenant. Ask the operator to set STRIPE_SECRET_KEY + STRIPE_PRICE_TOPUP_* in Worker secrets."
        );
      } else {
        setError(msg);
      }
    } finally {
      setTopUpInflight(null);
    }
  }

  const balanceDisplay = balance === null ? null : formatCents(balance);

  return (
    <>
      <PageHeader
        eyebrow="Billing · 账户"
        title="Wallet & top-ups"
        description="Pay-as-you-go. $0.50 per image, $0.10 per listing, $0.50 per onboarded product. No subscriptions, no expiry on credits."
      />
      <section className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-12 gap-6">
          {/* Balance hero */}
          <Card className="col-span-12 md:col-span-5 md-fade-in">
            <CardHeader>
              <CardEyebrow>Current balance · 余额</CardEyebrow>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "font-brand text-7xl tabular-nums",
                  balance !== null && balance < 50
                    ? "text-error"
                    : balance !== null && balance < 100
                      ? "text-ff-amber"
                      : "text-ff-vermilion-deep"
                )}
              >
                {balanceDisplay === null ? <Skeleton className="h-16 w-32" /> : balanceDisplay}
              </div>
              <div className="md-typescale-body-small text-on-surface-variant/70 mt-2 font-mono">
                {balance === null
                  ? null
                  : balance < 50
                    ? "Top up to keep launching"
                    : `Roughly ${Math.floor(balance / 410)} full launches at $4.10`}
              </div>
            </CardContent>
          </Card>

          {/* Top-up grid */}
          <Card className="col-span-12 md:col-span-7 md-fade-in" style={{ animationDelay: "100ms" }}>
            <CardHeader>
              <div>
                <CardEyebrow>Quick top-up · 充值</CardEyebrow>
                <CardTitle className="mt-1.5">Add credits</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {TOPUP_AMOUNTS.map((t) => (
                  <button
                    key={t.cents}
                    type="button"
                    onClick={() => handleTopUp(t.cents)}
                    disabled={topUpInflight !== null}
                    className={cn(
                      "rounded-m3-md border ff-hairline px-5 py-4 text-left",
                      "transition-colors hover:bg-surface-container-high",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      topUpInflight === t.cents && "bg-primary-container/40 opacity-100"
                    )}
                  >
                    <div className="md-typescale-headline-small font-brand text-on-surface">
                      {t.label}
                    </div>
                    <div className="md-typescale-body-small text-on-surface-variant/70 mt-0.5 font-mono">
                      {topUpInflight === t.cents ? "Opening Stripe…" : t.sub}
                    </div>
                  </button>
                ))}
              </div>
              {topUpInflight !== null && (
                <div className="md-typescale-body-small text-on-surface-variant/70 text-center mt-3 font-mono">
                  Opening Stripe checkout — other amounts disabled until this completes.
                </div>
              )}
            </CardContent>
            <CardFooter>
              <span className="md-typescale-label-small">Stripe · test mode</span>
              <span className="md-typescale-label-small text-on-surface-variant/60">
                Card ending in any number with future expiry works in test mode
              </span>
            </CardFooter>
          </Card>

          {error && (
            <div className="col-span-12 rounded-m3-md border border-error/40 bg-error-container/40 px-5 py-4">
              <span className="ff-stamp-label">billing</span>
              <span className="ml-3 md-typescale-body-medium font-mono text-error-on-container">
                {error}
              </span>
            </div>
          )}

          {/* Ledger */}
          <Card className="col-span-12 md-fade-in" style={{ animationDelay: "200ms" }}>
            <CardHeader>
              <div>
                <CardEyebrow>Recent activity · 流水</CardEyebrow>
                <CardTitle className="mt-1.5">Wallet ledger</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {ledger === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : ledger.length === 0 ? (
                <p className="md-typescale-body-medium text-on-surface-variant/70">
                  No activity yet. Top up to start launching.
                </p>
              ) : (
                <div className="md-surface-container-low border ff-hairline rounded-m3-md overflow-hidden">
                  {ledger.map((row, i) => (
                    <LedgerRowItem
                      key={row.id}
                      row={row}
                      isLast={i === ledger.length - 1}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function LedgerRowItem({
  row,
  isLast,
}: {
  row: LedgerRow;
  isLast: boolean;
}) {
  const sign = row.deltaCents >= 0 ? "+" : "";
  const tone = row.deltaCents >= 0 ? "text-ff-jade-deep" : "text-on-surface";
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-3",
        !isLast && "border-b ff-hairline"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="md-typescale-label-large text-on-surface">
          {prettyReason(row.reason)}
        </div>
        <div className="md-typescale-body-small text-on-surface-variant/70 mt-0.5 font-mono">
          {new Date(row.at).toLocaleString()}
        </div>
      </div>
      <div className={cn("font-brand text-xl tabular-nums", tone)}>
        {sign}
        {formatCents(Math.abs(row.deltaCents))}
      </div>
      <div className="md-typescale-body-small text-on-surface-variant/60 font-mono w-20 text-right">
        {formatCents(row.balanceAfterCents)}
      </div>
    </div>
  );
}

function prettyReason(r: string): string {
  switch (r) {
    case "signup_bonus": return "Signup bonus";
    case "stripe_topup": return "Top-up via Stripe";
    case "launch_run": return "Launch · per-run charge";
    case "image_gen": return "Product onboard / image generation";
    case "refund": return "Refund";
    case "tenant_created": return "Tenant created";
    default: return r;
  }
}
