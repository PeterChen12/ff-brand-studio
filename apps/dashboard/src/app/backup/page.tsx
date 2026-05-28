"use client";

/**
 * /backup — the always-reachable escape hatch.
 *
 * Renders the EmergencyAccess UI WITHOUT mounting Clerk. Even if Clerk's
 * CDN is unreachable, this route still works because:
 *   - It's a static-export Next.js page (no SSR, no Edge runtime needed)
 *   - The ClerkProvider only mounts in clerk-runtime.tsx, which the Shell
 *     bypasses for `/sign-in`/`/sign-up` paths. We extend the bypass to
 *     `/backup` in shell.tsx so this page renders raw without the Clerk
 *     wrapper interfering.
 *
 * Tell users: "If you ever can't sign in, go to image-generation.buyfishingrod.com/backup
 * and paste the ff_live_ key we sent you. That always works."
 */

import { EmergencyAccess } from "@/components/layout/emergency-access";

export default function BackupPage() {
  return (
    <EmergencyAccess
      title="Backup access"
      subtitle="Use this page to sign in with a backup access key. This works even when the regular sign-in is down."
    />
  );
}
