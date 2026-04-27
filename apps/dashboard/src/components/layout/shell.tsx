"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { MCP_URL } from "@/lib/config";

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
  { href: "/assets", label: "Asset Manifest", sub: "资产清单", index: "02" },
  { href: "/campaigns/new", label: "New Campaign", sub: "新活动", index: "03" },
  { href: "/seo", label: "SEO Atelier", sub: "文案工坊", index: "04" },
  { href: "/costs", label: "Cost Ledger", sub: "成本台账", index: "05" },
];

type HealthState = "ok" | "degraded" | "error" | "loading";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [health, setHealth] = useState<HealthState>("loading");
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const dotClass = {
    ok: "bg-tertiary",
    degraded: "bg-ff-amber",
    error: "bg-error",
    loading: "bg-outline-variant",
  }[health];

  return (
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
            <div className="md-typescale-title-medium italic text-on-surface-variant mt-1">
              Brand Studio
            </div>
            <div className="md-typescale-label-small text-ff-vermilion-deep mt-3">
              成 — chéng / shipping ops
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
                  <div className="md-typescale-label-large leading-tight">
                    {n.label}
                  </div>
                  <div
                    className={cn(
                      "md-typescale-body-small leading-tight mt-0.5",
                      active
                        ? "text-primary-on-container/70"
                        : "text-on-surface-variant/60"
                    )}
                  >
                    {n.sub}
                  </div>
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Health probe footer — M3 chip-like surface */}
        <div className="px-5 pt-6 pb-7 border-t ff-hairline mt-auto">
          <div className="md-typescale-label-small text-on-surface-variant mb-2.5">
            Service Status
          </div>
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full transition-colors",
                dotClass,
                health === "ok" && "ring-2 ring-tertiary/25 ring-offset-1 ring-offset-surface-container-low"
              )}
            />
            <span className="md-typescale-label-medium uppercase tracking-stamp">
              {health === "loading" ? "checking" : health}
            </span>
            {pingMs !== null && (
              <span className="font-mono text-[0.625rem] text-on-surface-variant/70 ml-auto">
                {pingMs}ms
              </span>
            )}
          </div>
          <div className="font-mono text-[0.625rem] text-on-surface-variant/60 mt-3 leading-relaxed">
            ff-brand-studio-mcp
            <br />
            <span className="text-on-surface-variant/50">v0.2.0 · prod</span>
          </div>
        </div>
      </aside>

      {/* ── Main content with editorial gutter ───────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
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
                <span className="md-typescale-label-small text-ff-vermilion-deep block mt-1">
                  Brand Studio · 文案工坊
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
                    {n.label}
                  </Link>
                );
              })}
            </aside>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}
