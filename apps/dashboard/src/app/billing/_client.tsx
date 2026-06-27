"use client";

/**
 * Phase H3 — wallet + billing surface.
 *
 * Shows current balance, recent ledger rows, and quick top-up buttons.
 * Top-up calls /v1/billing/checkout-session and mounts Stripe Embedded
 * Checkout from the returned client_secret in a modal. Whether top-ups are
 * available (and the publishable key needed to mount the embed) is read at
 * runtime from /v1/billing/config — so the static export needs no build-time
 * NEXT_PUBLIC_STRIPE_* and, when Stripe isn't configured, the UI shows an
 * honest "not enabled yet" state instead of a button that opens a dead toast.
 */

import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { useApiFetch } from "@/lib/api";
import { useApiQuery, useApiQueryAllPages } from "@/lib/api-query";
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
  // Pages through the full ledger so transaction history isn't silently
  // truncated (was capped at 100). balance_cents comes from the first page.
  const { data, error, isLoading, mutate } = useApiQueryAllPages<{
    ledger: LedgerRow[];
    balance_cents: number;
  }>("/v1/billing/ledger", "ledger");
  const ledger = data?.ledger ?? null;
  const balance = data?.balance_cents ?? null;

  // Whether wallet top-ups are wired + the publishable key to mount the embed.
  // Read at runtime so the static build needs no NEXT_PUBLIC_STRIPE_* and the
  // UI can render an honest disabled state when Stripe isn't configured.
  const { data: billingConfig, isLoading: configLoading } = useApiQuery<{
    configured: boolean;
    publishable_key: string | null;
  }>("/v1/billing/config");
  const stripeConfigured = billingConfig?.configured ?? false;
  const publishableKey = billingConfig?.publishable_key ?? null;

  // loadStripe once per publishable key — a stable promise the
  // EmbeddedCheckoutProvider consumes; null until we know the key.
  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const [topUpInflight, setTopUpInflight] = useState<number | null>(null);
  // When set, the embedded-checkout modal is open for this client_secret.
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);

  // After Stripe redirects back to /billing?session_id=… the payment has been
  // submitted. The wallet is credited asynchronously by the stripe-webhook, so
  // confirm + refresh the ledger, then strip the param so a reload doesn't
  // re-toast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("session_id")) return;
    toast.success(
      "Payment received — your balance updates within a few seconds.",
    );
    void mutate();
    const url = new URL(window.location.href);
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url.toString());
  }, [mutate]);

  async function handleTopUp(amountCents: number) {
    setTopUpInflight(amountCents);
    try {
      const res = await apiFetch<{ client_secret: string } | { error: string }>(
        "/v1/billing/checkout-session",
        {
          method: "POST",
          body: JSON.stringify({ amount_cents: amountCents }),
        },
      );
      if ("client_secret" in res && res.client_secret) {
        setCheckoutSecret(res.client_secret);
      } else {
        toast.error(
          "Top-ups aren't enabled yet. Ask the operator to finish Stripe setup.",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("503") || msg.includes("not_configured")) {
        toast.error(
          "Top-ups aren't enabled yet (Stripe isn't configured for this environment).",
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
              {!configLoading && !stripeConfigured && (
                <div className="mb-3 rounded-m3-md border ff-hairline bg-surface-container px-4 py-3 md-typescale-body-small text-on-surface-variant">
                  Top-ups aren&apos;t enabled in this environment yet. Once
                  Stripe is configured, these buttons open secure checkout here.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {TOPUP_AMOUNTS.map((t) => (
                  <button
                    key={t.cents}
                    type="button"
                    onClick={() => handleTopUp(t.cents)}
                    disabled={
                      topUpInflight !== null || configLoading || !stripeConfigured
                    }
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
                      {topUpInflight === t.cents ? "Opening checkout…" : t.sub}
                    </div>
                  </button>
                ))}
              </div>
              {topUpInflight !== null && (
                <div className="md-typescale-body-small text-on-surface-variant/70 text-center mt-3 font-mono">
                  Opening secure checkout — other amounts disabled until this
                  completes.
                </div>
              )}
            </CardContent>
            <CardFooter>
              <span className="md-typescale-label-small">Secured by Stripe</span>
              <span className="md-typescale-label-small text-on-surface-variant/60">
                Checkout opens in-page · credits land within a few seconds of
                payment
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

      {checkoutSecret && stripePromise && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Secure checkout"
        >
          <div className="my-auto w-full max-w-xl rounded-m3-lg bg-surface shadow-m3-3">
            <div className="flex items-center justify-between border-b ff-hairline px-5 py-3">
              <span className="md-typescale-title-medium">
                Add credits · 充值
              </span>
              <button
                type="button"
                onClick={() => setCheckoutSecret(null)}
                className="h-8 w-8 rounded-m3-full hover:bg-surface-container-high md-typescale-label-large"
                aria-label="Close checkout"
              >
                ✕
              </button>
            </div>
            <div className="p-2">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{ clientSecret: checkoutSecret }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </div>
        </div>
      )}
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
