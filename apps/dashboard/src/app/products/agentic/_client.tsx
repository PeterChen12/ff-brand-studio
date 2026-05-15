"use client";

/**
 * Phase H · 2026-05-14 — agentic upload has been consolidated into the
 * unified /products/bulk smart-router. This file is just a redirect so
 * deep links and stale tabs keep working.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AgenticUploadRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/products/bulk?from=agentic");
  }, [router]);
  return (
    <div className="px-6 md:px-12 py-12 max-w-7xl mx-auto">
      <p className="md-typescale-body-medium text-on-surface-variant">
        Redirecting to the unified bulk upload…
      </p>
    </div>
  );
}
