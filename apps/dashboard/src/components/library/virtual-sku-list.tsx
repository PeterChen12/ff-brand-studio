"use client";

import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SkuGroupShape } from "@/components/library/types";

interface Props {
  groups: SkuGroupShape[];
  renderGroup: (group: SkuGroupShape, index: number) => React.ReactNode;
  /** Estimated row height in px; the virtualizer measures actual heights. */
  estimateSize?: number;
}

export function VirtualSkuList({
  groups,
  renderGroup,
  estimateSize = 520,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 1,
    measureElement:
      typeof window !== "undefined" &&
      typeof ResizeObserver !== "undefined"
        ? (el) => el?.getBoundingClientRect().height ?? estimateSize
        : undefined,
  });

  const items = virtualizer.getVirtualItems();

  // Disable virtualization below a threshold — for ≤8 groups the parent
  // fixed-height scroller adds friction without buying anything.
  const tooFewToVirtualize = groups.length <= 8;

  const totalSize = virtualizer.getTotalSize();

  // Memoize rendered children so the virtual recompute doesn't replay
  // expensive child renders unnecessarily.
  const rendered = useMemo(
    () => groups.map((g, i) => renderGroup(g, i)),
    [groups, renderGroup]
  );

  if (tooFewToVirtualize) {
    return <div className="space-y-7">{rendered}</div>;
  }

  return (
    <div
      ref={parentRef}
      className="overflow-auto"
      style={{ height: "calc(100vh - 280px)", contain: "strict" }}
    >
      <div style={{ height: totalSize, width: "100%", position: "relative" }}>
        {items.map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${vi.start}px)`,
              paddingBottom: 28,
            }}
          >
            {rendered[vi.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
