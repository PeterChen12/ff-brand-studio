"use client";

import { Card, CardEyebrow } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { AssetRow } from "@/db/schema";

const PUB_URL = "https://pub-db3f39e3386347d58359ba96517eec84.r2.dev";

function scoreVariant(score: number | null): "passed" | "pending" | "flagged" | "neutral" {
  if (score === null || score === 0) return "neutral";
  if (score >= 85) return "passed";
  if (score >= 70) return "pending";
  return "flagged";
}

function tone(s: number | null): string {
  if (s === null || s === 0) return "—";
  return `${s}/100`;
}

export function AssetCard({ asset }: { asset: AssetRow }) {
  const score = asset.brandScore ?? 0;
  const variant = scoreVariant(score);
  const isImage = asset.assetType?.includes("image") || asset.assetType?.includes("infographic");
  const url = `${PUB_URL}/${asset.r2Key}`;

  return (
    <Card className="group overflow-hidden flex flex-col">
      <div className={cn("relative bg-paper-dim/40 border-b border-mist overflow-hidden aspect-[4/3]")}>
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={asset.r2Key}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-mute font-mono text-xs uppercase tracking-stamp">
            {asset.assetType ?? "asset"}
          </div>
        )}
        {score > 0 && (
          <div className="absolute top-3 right-3 animate-stamp-in">
            <Badge variant={variant}>{tone(score)}</Badge>
          </div>
        )}
      </div>

      <div className="px-4 pt-3 pb-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardEyebrow className="text-vermilion-deep">{asset.assetType ?? "asset"}</CardEyebrow>
          <span className="font-mono text-2xs text-ink-mute uppercase tracking-stamp">
            {asset.locale ?? "—"}
          </span>
        </div>
        <div className="text-sm font-medium text-ink leading-snug truncate" title={asset.campaign ?? ""}>
          {asset.campaign ?? <span className="text-ink-mute italic">untitled campaign</span>}
        </div>
        <div className="flex items-center gap-2 text-2xs text-ink-mute font-mono pt-1">
          <span className="truncate" title={asset.r2Key}>
            {asset.r2Key.split("/").slice(-1)[0]}
          </span>
          {asset.platform && (
            <>
              <span className="text-mist">·</span>
              <span className="uppercase">{asset.platform}</span>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
