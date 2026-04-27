"use client";

/**
 * Phase G — client-only ClerkProvider for static-export Next.js.
 *
 * The dashboard ships as a fully static export (`output: "export"`),
 * which doesn't tolerate Server Actions or Edge runtime requirements.
 * Two distinct constraints land us here:
 *
 *   1. @clerk/nextjs's ClerkProvider uses Server Actions for keyless
 *      session sync — Next refuses to compile that under static export.
 *      So we use @clerk/clerk-react's pure-React provider instead.
 *
 *   2. @clerk/clerk-react bundles browser-only webpack constants
 *      (`packageName`) that the Next prerender server doesn't define,
 *      producing a "packageName is not defined" ReferenceError when the
 *      MODULE is imported during prerender. A mounted-gate alone isn't
 *      enough because the import statement itself runs before render.
 *      `next/dynamic` with `ssr: false` defers BOTH the import and the
 *      module evaluation until the browser, side-stepping the issue.
 */

import dynamic from "next/dynamic";
import { M3Register } from "@/components/m3-register";

const ClerkRuntime = dynamic(
  () => import("./clerk-runtime").then((m) => m.ClerkRuntime),
  {
    ssr: false,
    loading: () => <div className="min-h-screen md-surface" />,
  }
);

export function ClerkAppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <M3Register />
      <ClerkRuntime>{children}</ClerkRuntime>
    </>
  );
}
