"use client";

/**
 * Emergency access UI — bypasses Clerk entirely.
 *
 * Renders in two places:
 *   1. /backup page (always reachable, no Clerk dependency)
 *   2. Inline overlay when Clerk fails to initialize within a timeout
 *
 * Background: on 2026-05-28 a Clerk-side misconfiguration (allowed_origins
 * missing image-generation.buyfishingrod.com) left every user stuck on
 * "LOADING…" with no recovery path. The ff_live_ fallback URL existed but
 * users didn't know the magic query-param syntax. This component closes
 * that gap — anyone can paste their key OR navigate to /backup and get in
 * regardless of what Clerk is doing.
 */

import { useState } from "react";
import { setFallbackKey } from "@/lib/fallback-auth";

const SUPPORT_EMAIL = "support@creatorain.com";
const HELP_URL = "https://creatorain.com/help/backup-access";

interface Props {
  /** Headline. Defaults to "Sign-in unavailable" — override for the
   *  static /backup page to "Backup access". */
  title?: string;
  /** One-line subtitle explaining what's going on. */
  subtitle?: string;
  /** If true, surface this as a full-page splash. If false, render as a
   *  centered card (overlay variant). Default true. */
  fullScreen?: boolean;
}

export function EmergencyAccess({
  title = "Sign-in is unavailable",
  subtitle = "The authentication service isn't responding. If you have a backup access key, paste it below to continue.",
  fullScreen = true,
}: Props) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = key.trim();
    if (!trimmed.startsWith("ff_live_")) {
      setError(
        "Backup keys start with ff_live_. Double-check the link you were sent, or contact support."
      );
      return;
    }
    if (trimmed.length < 24) {
      setError("That key looks too short. Copy the full key including ff_live_.");
      return;
    }
    setSubmitting(true);
    setFallbackKey(trimmed);
    // Force a clean reload so all hooks re-read the persisted key and the
    // Shell's gating logic picks it up immediately. The Shell already has
    // a fallback-first short-circuit (apps/dashboard/src/components/layout/shell.tsx),
    // so the next render bypasses Clerk entirely.
    window.location.assign("/");
  };

  const wrapper = fullScreen
    ? "min-h-screen md-surface flex items-center justify-center px-6 py-12"
    : "md-surface flex items-center justify-center px-6 py-12";

  return (
    <div className={wrapper}>
      <div className="max-w-md w-full">
        <div className="ff-stamp-label mb-3">backup access · 应急通道</div>
        <h1 className="md-typescale-headline-large text-on-surface mb-3">
          {title}
        </h1>
        <p className="md-typescale-body-large text-on-surface-variant mb-6">
          {subtitle}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="ff-stamp-label">backup key</span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="ff_live_..."
              className="font-mono text-sm px-3 py-2 rounded-m3-md border ff-hairline bg-surface-container-low text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={submitting}
              autoFocus
            />
          </label>

          {error && (
            <p
              role="alert"
              className="md-typescale-body-small text-error"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !key}
            className="bg-primary text-on-primary rounded-m3-full py-2.5 px-5 font-medium tracking-wide disabled:opacity-50 transition-opacity"
          >
            {submitting ? "Continuing…" : "Continue"}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t ff-hairline">
          <p className="md-typescale-body-small text-on-surface-variant/80 mb-2">
            Don't have a key?
          </p>
          <ul className="md-typescale-body-small text-on-surface-variant space-y-1">
            <li>
              Email{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-primary hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>{" "}
              and we'll send one within the hour.
            </li>
            <li>
              <a
                href={HELP_URL}
                target="_blank"
                rel="noopener"
                className="text-primary hover:underline"
              >
                Read the backup access guide
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
