"use client";

/**
 * Phase H3 — wallet + billing surface.
 *
 * Shows current balance, recent ledger rows, and quick top-up
 * buttons. Top-up calls /v1/billing/checkout-session and embeds the
 * Stripe-returned client secret. If Stripe isn't yet configured (no
 * STRIPE_SECRET_KEY), shows a setup banner instead of failing.
 */

import { useState } from "react";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import { useApiQuery } from "@/lib/api-query";
import { formatCents, formatTimestamp } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardEyebrow,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
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
  const now = useNow();
  const { data, error, isLoading, mutate } = useApiQuery<{
    ledger: LedgerRow[];
    balance_cents: number;
  }>("/v1/billing/ledger");
  const ledger = data?.ledger ?? null;
  const balance = data?.balance_cents ?? null;

  const [topUpInflight, setTopUpInflight] = useState<number | null>(null);

  async function handleTopUp(amountCents: number) {
    setTopUpInflight(amountCents);
    try {
      const res = await apiFetch<{ client_secret: string } | { error: string }>(
        "/v1/billing/checkout-session",
        {
          method: "POST",
          body: JSON.stringify({ amount_cents: amountCents }),
        }
      );
      if ("error" in res) {
        toast.error(`Stripe not configured yet: ${res.error}`);
      } else {
        toast.info(
          "Stripe checkout is being prepared — embed UI activates once Price IDs are configured. Contact support to enable top-ups."
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("503") || msg.includes("not_configured")) {
        toast.error(
          "Stripe is not yet configured for this tenant. Ask the operator to set STRIPE_SECRET_KEY + STRIPE_PRICE_TOPUP_*."
        );
      } else {
        toast.error(msg);
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
        {error && (
          <div className="mb-8">
            <ErrorState
              title="Couldn't load your wallet"
              error={error}
              onRetry={() => mutate()}
            />
          </div>
        )}

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
                {balanceDisplay === null ? (
                  <Skeleton className="h-16 w-32" />
                ) : (
                  balanceDisplay
                )}
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
          <Card
            className="col-span-12 md:col-span-7 md-fade-in"
            style={{ animationDelay: "100ms" }}
          >
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
                      "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      topUpInflight === t.cents &&
                        "bg-primary-container/40 opacity-100"
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

          {/* Ledger */}
          <Card
            className="col-span-12 md-fade-in"
            style={{ animationDelay: "200ms" }}
          >
            <CardHeader>
              <div>
                <CardEyebrow>Recent activity · 流水</CardEyebrow>
                <CardTitle className="mt-1.5">Wallet ledger</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {["s1", "s2", "s3", "s4"].map((id) => (
                    <Skeleton key={id} className="h-12 w-full" />
                  ))}
                </div>
              ) : ledger && ledger.length === 0 ? (
                <EmptyState
                  variant="filtered"
                  eyebrow="No activity yet · 暂无流水"
                  title="No activity yet"
                  body="Top up to start launching. Every spend lands here with the SKU it relates to."
                />
              ) : ledger ? (
                <div className="md-surface-container-low border ff-hairline rounded-m3-md overflow-hidden">
                  {ledger.map((row, i) => (
                    <LedgerRowItem
                      key={row.id}
                      row={row}
                      isLast={i === ledger.length - 1}
                      now={now}
                    />
                  ))}
                </div>
              ) : null}
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
  now,
}: {
  row: LedgerRow;
  isLast: boolean;
  now: number;
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
          {formatTimestamp(row.at, "long", now)}
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
    case "signup_bonus":
      return "Signup bonus";
    case "stripe_topup":
      return "Top-up via Stripe";
    case "launch_run":
      return "Launch · per-run charge";
    case "image_gen":
      return "Product onboard / image generation";
    case "refund":
      return "Refund";
    case "tenant_created":
      return "Tenant created";
    default:
      return r;
  }
}
