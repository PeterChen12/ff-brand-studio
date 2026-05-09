"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  RedirectToSignIn,
  OrganizationSwitcher,
  UserButton,
  useAuth,
} from "@clerk/react";
import { cn } from "@/lib/cn";
import { MCP_URL } from "@/lib/config";
import { formatCents } from "@/lib/format";
import { TenantProvider, type TenantSnapshot } from "@/lib/tenant-context";
import { OrgGate } from "@/components/layout/org-gate";

/**
 * M3 navigation drawer pattern — modified.
 *
 * Standard M3 navigation drawer renders in a 360-wide column. We pull it
 * tighter to 256px and replace the default body-medium label with our
 * label-small (uppercase mono) for the nav indices, keeping FF's customs-
 * ledger feel inside an otherwise clean M3 surface.
 *
 * The drawer is built from custom HTML rather than <md-list> so the indent
 * + active-state visual ("vermilion seal stripe at the leading edge") can
 * stay distinctive — M3 list-item's tonal active state would feel generic
 * inside this brand. Other M3 primitives (buttons, chips, text fields) DO
 * use @material/web web components for consistency with the spec.
 */
const NAV: { href: string; label: string; sub: string; index: string }[] = [
  { href: "/", label: "Overview", sub: "总览", index: "01" },
  { href: "/products/new", label: "Add product", sub: "添加产品", index: "02" },
  { href: "/launch", label: "Create listing", sub: "新建产品", index: "03" },
  { href: "/library", label: "Library", sub: "资产库", index: "04" },
  { href: "/inbox", label: "Inbox", sub: "审核队列", index: "05" },
  { href: "/costs", label: "Costs", sub: "成本", index: "06" },
  { href: "/billing", label: "Billing", sub: "账户", index: "07" },
  { href: "/settings", label: "Settings", sub: "设置", index: "08" },
];

type HealthState = "ok" | "degraded" | "error" | "loading";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { isLoaded, isSignedIn } = useAuth();

  // Auth-only routes render their own layout — bypass the Shell entirely.
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
    return <>{children}</>;
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen md-surface flex items-center justify-center">
        <div className="md-typescale-label-small text-on-surface-variant tracking-stamp uppercase">
          Loading…
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn />;
  }

  return (
    <OrgGate>
      <ShellInner pathname={pathname}>{children}</ShellInner>
    </OrgGate>
  );
}

function ShellInner({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  const { getToken, isSignedIn, orgId } = useAuth();
  const [health, setHealth] = useState<HealthState>("loading");
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Wallet pill states. "auth-error" is distinct from "unknown-error"
  // so we surface 401/403 explicitly — during the org-context bug
  // operators saw `—` for hours with no signal that auth was the cause.
  const [walletState, setWalletState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; cents: number }
    | { kind: "auth-error" }
    | { kind: "unknown-error" }
  >({ kind: "loading" });
  // Tenant snapshot — flows down via TenantProvider so descendants
  // (e.g. LaunchWizard) can read default_platforms without a second
  // /v1/me/state call.
  const [tenant, setTenant] = useState<TenantSnapshot | null>(null);
  // Phase C · Iter 13 — language display preference. Drives whether
  // sidebar nav labels show English only / 中文 only / both. Default
  // "both" (backwards compatible). Read from tenant.features once it
  // arrives.
  const langDisplay: "en" | "zh" | "both" = (() => {
    const raw = tenant?.features?.language_display;
    if (raw === "en" || raw === "zh" || raw === "both") return raw;
    return "both";
  })();
  const showEn = langDisplay === "en" || langDisplay === "both";
  const showZh = langDisplay === "zh" || langDisplay === "both";
  // P1-4 — surface offline state so silent fetch failures aren't
  // misread as bugs; banner pulls down at the top until reconnect.
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // P1-6 — ESC closes the mobile drawer. Without this, keyboard users
  // (and screen-reader users) had no non-mouse exit path.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      const t0 = performance.now();
      fetch(`${MCP_URL}/health`)
        .then((r) => r.json())
        .then((j: { status?: string }) => {
          if (!alive) return;
          setHealth((j.status as HealthState) ?? "error");
          setPingMs(Math.round(performance.now() - t0));
        })
        .catch(() => alive && setHealth("error"));
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Phase H4 — wallet pill in the sidebar. Polls /v1/me/state every
  // 60s. Uses Clerk's getToken (with skipCache so the JWT reflects the
  // currently-active org) — the prior cookie-reading approach broke
  // when __session became HttpOnly and was a workaround anyway.
  useEffect(() => {
    if (!isSignedIn) return;
    let alive = true;
    async function poll() {
      try {
        const token = await getToken({
          skipCache: true,
          organizationId: orgId ?? undefined,
        });
        if (!token) {
          if (alive) setWalletState({ kind: "auth-error" });
          return;
        }
        const res = await fetch(`${MCP_URL}/v1/me/state`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!alive) return;
        if (res.status === 401 || res.status === 403) {
          if (typeof console !== "undefined") {
            // eslint-disable-next-line no-console
            console.warn(
              "[wallet-pill]",
              res.status,
              await res.text().catch(() => "")
            );
          }
          setWalletState({ kind: "auth-error" });
          return;
        }
        if (!res.ok) {
          if (typeof console !== "undefined") {
            // eslint-disable-next-line no-console
            console.warn(
              "[wallet-pill]",
              res.status,
              await res.text().catch(() => "")
            );
          }
          setWalletState({ kind: "unknown-error" });
          return;
        }
        const data = (await res.json()) as {
          tenant?: {
            id?: string;
            name?: string;
            plan?: string;
            wallet_balance_cents?: number;
            features?: Record<string, unknown>;
          };
        };
        if (typeof data.tenant?.wallet_balance_cents === "number") {
          setWalletState({ kind: "ok", cents: data.tenant.wallet_balance_cents });
        } else {
          setWalletState({ kind: "unknown-error" });
        }
        if (
          data.tenant?.id &&
          data.tenant?.name &&
          data.tenant?.plan
        ) {
          setTenant({
            id: data.tenant.id,
            name: data.tenant.name,
            plan: data.tenant.plan,
            features: (data.tenant.features as Record<string, unknown>) ?? {},
          });
        }
      } catch {
        if (alive) setWalletState({ kind: "unknown-error" });
      }
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // pathname intentionally NOT a dep — refiring poll on every nav
    // burned a request per route change with no benefit (P2-7).
  }, [isSignedIn, getToken, orgId]);

  const dotClass = {
    ok: "bg-tertiary",
    degraded: "bg-ff-amber",
    error: "bg-error",
    loading: "bg-outline-variant",
  }[health];

  return (
    <TenantProvider value={tenant}>
    <div className="min-h-screen md-surface flex">
      {/* ── M3 navigation drawer (left) ──────────────────────────────────── */}
      <aside
        className={cn(
          "hidden md:flex w-64 shrink-0 flex-col",
          "md-surface-container-low border-r ff-hairline"
        )}
      >
        {/* Brand mark — Fraunces lockup, vermilion seal as the focal point */}
        <div className="px-7 pt-7 pb-9 relative">
          <Link href="/" className="block group">
            <div className="flex items-baseline gap-2">
              <span className="font-brand text-[2.5rem] font-semibold leading-none tracking-tight">
                FF
              </span>
              <span
                className="inline-block h-2 w-2 rounded-full bg-primary translate-y-[-2px] group-hover:scale-125 transition-transform duration-m3-short4 ease-m3-emphasized"
                aria-hidden
              />
            </div>
            <div className="md-typescale-title-medium text-on-surface-variant mt-1">
              Brand Studio
            </div>
            <div className="md-typescale-label-small text-on-surface-variant/70 mt-2.5 leading-relaxed">
              Product images + listings, at scale
            </div>
          </Link>
        </div>

        {/* Drawer items */}
        <nav className="px-3 flex-1 flex flex-col gap-1">
          {NAV.map((n, i) => {
            const active =
              n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "group relative flex items-center gap-3.5 px-4 py-2.5",
                  "rounded-m3-full transition-all duration-m3-short4 ease-m3-emphasized",
                  active
                    ? "bg-primary-container text-primary-on-container"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                )}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {/* Vermilion seal stripe — only on active item, replaces M3's
                    default tonal-only treatment with FF's customs-stamp DNA */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-sm",
                    "bg-primary transition-opacity duration-m3-short3",
                    active ? "opacity-100" : "opacity-0"
                  )}
                />
                <span
                  className={cn(
                    "font-mono text-[0.6875rem] tracking-stamp shrink-0 w-5",
                    active ? "text-ff-vermilion-deep" : "text-on-surface-variant/70"
                  )}
                >
                  {n.index}
                </span>
                <span className="flex-1 min-w-0">
                  {showEn && (
                    <div className="md-typescale-label-large leading-tight">
                      {n.label}
                    </div>
                  )}
                  {showZh && (
                    <div
                      className={cn(
                        "md-typescale-body-small leading-tight",
                        showEn && "mt-0.5",
                        active
                          ? "text-primary-on-container/70"
                          : "text-on-surface-variant/60",
                        // When zh-only, promote font size to match label
                        !showEn && "md-typescale-label-large"
                      )}
                    >
                      {n.sub}
                    </div>
                  )}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Wallet pill — clickable, routes to /billing. Color shifts
            amber under $1 and red under $0.50 per ADR-0005. Auth
            errors route to /sign-in instead of /billing so the user
            can recover without guessing what broke (P1-5). */}
        <Link
          href={walletState.kind === "auth-error" ? "/sign-in" : "/billing"}
          className={cn(
            "mx-3 mb-2 mt-auto px-4 py-3 rounded-m3-md",
            "transition-colors hover:bg-surface-container-high",
            "border ff-hairline flex items-center justify-between",
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          )}
          title={
            walletState.kind === "auth-error"
              ? "Credits check failed — sign back in"
              : walletState.kind === "unknown-error"
                ? "Credits poll failed — temporary network issue"
                : "Click to add credits"
          }
        >
          <span className="ff-stamp-label">Credits · 余额</span>
          {walletState.kind === "auth-error" ? (
            <span className="md-typescale-label-medium text-error">
              Sign in →
            </span>
          ) : walletState.kind === "ok" ? (
            <div className="flex flex-col items-end">
              <span
                className={cn(
                  "font-brand tabular-nums text-lg",
                  walletState.cents < 50
                    ? "text-error"
                    : walletState.cents < 100
                      ? "text-ff-amber"
                      : "text-ff-vermilion-deep"
                )}
              >
                {formatCents(walletState.cents)}
              </span>
              {walletState.cents < 50 && (
                <span className="md-typescale-body-small text-error/90 leading-tight">
                  Top up to keep launching
                </span>
              )}
            </div>
          ) : (
            <span className="font-brand tabular-nums text-lg text-on-surface-variant/60">
              —
            </span>
          )}
        </Link>

        {/* Tenant + identity — Clerk OrganizationSwitcher acts as the
            tenant picker; the avatar opens the standard Clerk user menu. */}
        <div className="px-5 py-4 border-t ff-hairline flex items-center gap-3">
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/"
            afterSelectOrganizationUrl="/"
            appearance={{
              elements: {
                organizationSwitcherTrigger:
                  "flex-1 px-3 py-2 rounded-m3-full hover:bg-surface-container-high transition-colors text-left",
                organizationPreviewMainIdentifier:
                  "md-typescale-label-large text-on-surface",
                organizationPreviewSecondaryIdentifier:
                  "md-typescale-body-small text-on-surface-variant/70",
              },
            }}
          />
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-9 w-9 ring-1 ring-outline-variant",
              },
            }}
          />
        </div>

        {/* Service indicator — health probe to the Worker. */}
        <div
          className="px-5 py-3 border-t ff-hairline"
          title={`MCP Worker: ${health}${pingMs !== null ? ` · ${pingMs}ms` : ""}`}
        >
          <div className="flex items-center gap-2 md-typescale-body-small text-on-surface-variant/80">
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full transition-colors",
                dotClass
              )}
            />
            <span>API</span>
            <span className="text-on-surface-variant/50">·</span>
            <span className="text-on-surface-variant/60">{health === "loading" ? "checking" : health}</span>
            {pingMs !== null && (
              <span className="font-mono text-[0.625rem] text-on-surface-variant/50 ml-auto">
                {pingMs}ms
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main content with editorial gutter ───────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
        {/* P1-4 — offline banner. Sticks to the top above any sticky
            sub-headers; auto-dismisses when the browser regains net. */}
        {!online && (
          <div
            role="status"
            className="sticky top-0 z-20 px-5 py-2 bg-error-container/90 backdrop-blur-sm border-b border-error/40 text-error-on-container md-typescale-label-medium flex items-center gap-2 justify-center"
          >
            <span aria-hidden="true">⚠</span>
            <span>You're offline — we'll retry as soon as you reconnect.</span>
          </div>
        )}
        {/* M3 top app bar — small variant, only on mobile */}
        <div className="md:hidden sticky top-0 z-10 md-surface border-b ff-hairline px-5 h-14 flex items-center justify-between gap-3 backdrop-blur-sm bg-surface/95">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Open navigation"
            className="h-10 w-10 rounded-m3-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                d="M3 5h14M3 10h14M3 15h14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="font-brand text-lg font-semibold">FF Brand Studio</span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <span
            className={cn("inline-block h-2 w-2 rounded-full", dotClass)}
            aria-label={`status ${health}`}
          />
        </div>

        {/* Mobile drawer overlay — M3 modal-drawer pattern */}
        {drawerOpen && (
          <div
            className="md:hidden fixed inset-0 z-20 bg-scrim/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            role="presentation"
          >
            <aside
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-0 bottom-0 w-72 md-surface-container-low border-r ff-hairline px-3 py-6 animate-fade-up flex flex-col"
            >
              <Link
                href="/"
                onClick={() => setDrawerOpen(false)}
                className="px-4 pb-6 block"
              >
                <span className="font-brand text-2xl font-semibold">FF</span>
                <span className="md-typescale-label-small text-on-surface-variant/70 block mt-1">
                  Brand Studio · Product images + listings
                </span>
              </Link>
              {NAV.map((n) => {
                const active =
                  n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      "px-4 py-3 rounded-m3-full md-typescale-label-large transition-colors",
                      active
                        ? "bg-primary-container text-primary-on-container"
                        : "text-on-surface-variant hover:bg-surface-container-high"
                    )}
                  >
                    <span className="font-mono text-[0.6875rem] tracking-stamp mr-3 text-ff-vermilion-deep">
                      {n.index}
                    </span>
                    {showEn ? n.label : n.sub}
                  </Link>
                );
              })}
            </aside>
          </div>
        )}

        {children}
      </main>
    </div>
    </TenantProvider>
  );
}
