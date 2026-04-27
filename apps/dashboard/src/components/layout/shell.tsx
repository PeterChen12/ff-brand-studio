"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { MCP_URL } from "@/lib/config";

const NAV: { href: string; label: string; index: string }[] = [
  { href: "/", label: "Overview", index: "01" },
  { href: "/assets", label: "Asset Manifest", index: "02" },
  { href: "/campaigns/new", label: "New Campaign", index: "03" },
  { href: "/seo", label: "SEO Atelier", index: "04" },
  { href: "/costs", label: "Cost Ledger", index: "05" },
];

type HealthState = "ok" | "degraded" | "error" | "loading";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [health, setHealth] = useState<HealthState>("loading");
  const [pingMs, setPingMs] = useState<number | null>(null);

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
    ok: "bg-jade",
    degraded: "bg-amber",
    error: "bg-vermilion",
    loading: "bg-mist",
  }[health];

  return (
    <div className="min-h-screen bg-paper text-ink flex">
      {/* ── Vertical sidebar — narrow, ledger-like ───────────────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-mist bg-paper-deep/40">
        <div className="px-6 pt-7 pb-8">
          <Link href="/" className="block group">
            <div className="font-display text-3xl font-semibold leading-none tracking-tight">
              FF
            </div>
            <div className="font-display text-base italic text-ink-soft mt-0.5 leading-tight">
              Brand Studio
            </div>
            <div className="stamp-label mt-3 text-vermilion-deep">
              成 — chéng / shipping ops
            </div>
          </Link>
        </div>

        <nav className="px-3 flex-1 flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active =
              n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "group flex items-baseline gap-3 px-3 py-2 transition-colors",
                  active
                    ? "text-ink bg-paper-dim/70 border-l-2 border-vermilion"
                    : "text-ink-mute hover:text-ink hover:bg-paper-dim/30 border-l-2 border-transparent"
                )}
              >
                <span className="font-mono text-2xs text-ink-mute group-hover:text-vermilion">
                  {n.index}
                </span>
                <span className="text-sm font-medium tracking-tight">{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-6 pt-6 pb-7 border-t border-mist mt-auto">
          <div className="stamp-label mb-2">Service Status</div>
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "inline-block h-2 w-2",
                dotClass,
                health === "ok" && "shadow-[0_0_0_3px_rgb(var(--jade)/0.18)]"
              )}
            />
            <span className="font-mono text-xs uppercase tracking-stamp">
              {health === "loading" ? "checking" : health}
            </span>
            {pingMs !== null && (
              <span className="font-mono text-2xs text-ink-mute ml-auto">{pingMs}ms</span>
            )}
          </div>
          <div className="font-mono text-2xs text-ink-mute mt-3 leading-relaxed">
            ff-brand-studio-mcp
            <br />
            <span className="text-ink-mute/70">v0.2.0 · production</span>
          </div>
        </div>
      </aside>

      {/* ── Main content with editorial gutter ───────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
        {/* Mobile top bar (sidebar is hidden on small screens) */}
        <div className="md:hidden sticky top-0 z-10 border-b border-mist bg-paper/95 backdrop-blur px-5 py-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold">FF Brand Studio</div>
          <span className={cn("inline-block h-2 w-2", dotClass)} />
        </div>
        {children}
      </main>
    </div>
  );
}
