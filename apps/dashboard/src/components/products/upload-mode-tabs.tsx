"use client";

/**
 * Phase C · Iteration 04 — single/bulk upload mode tab strip.
 *
 * Both /products/new and /products/bulk render this above their forms
 * so a marketer doesn't miss the bulk path (it used to be a tiny text
 * link a 50-SKU customer would never find). Each tab is a real link;
 * the active tab matches the current pathname.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS: { href: string; label: string; sub: string }[] = [
  { href: "/products/new", label: "Single product", sub: "添加单个产品" },
  { href: "/products/bulk", label: "Bulk upload", sub: "批量上传" },
  { href: "/products/agentic", label: "Agentic upload", sub: "AI 整理" },
];

export function UploadModeTabs() {
  const pathname = usePathname() ?? "/products/new";
  return (
    <section className="px-6 md:px-12 pt-6 max-w-7xl mx-auto">
      <div role="tablist" className="flex items-center gap-1 border-b ff-hairline">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={active}
              className={cn(
                "h-10 px-4 md-typescale-label-large border-b-2 -mb-px transition-colors flex items-baseline gap-2",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-m3-sm",
                active
                  ? "border-primary text-on-surface"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              )}
            >
              <span>{t.label}</span>
              <span className="md-typescale-body-small text-on-surface-variant/60">
                {t.sub}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
