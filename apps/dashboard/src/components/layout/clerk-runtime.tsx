"use client";

/**
 * Browser-only Clerk runtime — loaded via next/dynamic({ ssr: false })
 * from clerk-app-shell.tsx so the @clerk/react module is never
 * imported during prerender. See clerk-app-shell.tsx for the rationale.
 */

import { useEffect } from "react";
import { ClerkProvider } from "@clerk/react";
import { Toaster } from "sonner";
import { Shell } from "@/components/layout/shell";
import { NowProvider } from "@/lib/use-now";
import { captureFallbackKeyFromUrl, useFallbackKey } from "@/lib/fallback-auth";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// Defensive guard — a previous deploy regression silently shipped a
// `pk_test_*` Clerk publishable key to production. Detection stays
// (loud console.error so operator tooling picks it up); the visible
// banner is gated behind ?clerk-debug=1 so end users don't see a
// red alarm bar for a config issue they can't act on.
const IS_DEV_CLERK_KEY = PUBLISHABLE_KEY.startsWith("pk_test_");
const IS_PROD_HOSTNAME =
  typeof window !== "undefined" &&
  !window.location.hostname.includes("localhost") &&
  !window.location.hostname.includes("127.0.0.1") &&
  !window.location.hostname.endsWith(".local");

function FallbackBanner() {
  const fallbackKey = useFallbackKey();
  if (!fallbackKey) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9998,
        background: "rgb(255 184 0)",
        color: "rgb(28 27 25)",
        padding: "6px 16px",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
      }}
    >
      Fallback API key active · Clerk bypassed
    </div>
  );
}

function ClerkKeyGuard() {
  useEffect(() => {
    if (IS_DEV_CLERK_KEY && IS_PROD_HOSTNAME) {
      // eslint-disable-next-line no-console
      console.error(
        "[clerk-key-guard] Production deploy is using a pk_test_* Clerk key. " +
          "Rotate NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to a pk_live_* key from " +
          "Clerk's production instance and redeploy. (Visible banner suppressed; " +
          "append ?clerk-debug=1 to surface it.)"
      );
    }
  }, []);

  const showBanner =
    IS_DEV_CLERK_KEY &&
    IS_PROD_HOSTNAME &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("clerk-debug") === "1";

  if (!showBanner) return null;
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "rgb(196, 57, 43)",
        color: "white",
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
    >
      ⚠ Clerk DEVELOPMENT key (pk_test_*) in production — rotate{" "}
      <code style={{ background: "rgba(0,0,0,0.15)", padding: "1px 6px", borderRadius: 3 }}>
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
      </code>{" "}
      to <code>pk_live_*</code>.
    </div>
  );
}

export function ClerkRuntime({ children }: { children: React.ReactNode }) {
  // Capture ?ff_api_key=... / ?ff_logout=1 once on mount so an operator
  // can hand the user a single emergency URL that bypasses Clerk.
  useEffect(() => {
    captureFallbackKeyFromUrl();
  }, []);

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      appearance={{
        variables: {
          colorPrimary: "rgb(196 57 43)",
          colorBackground: "rgb(255 251 247)",
          colorInputBackground: "rgb(255 255 255)",
          colorText: "rgb(28 27 25)",
          colorTextSecondary: "rgb(76 73 68)",
          fontFamily: "var(--md-ref-typeface-plain), system-ui, sans-serif",
          borderRadius: "0.75rem",
        },
        elements: {
          formButtonPrimary:
            "bg-primary text-on-primary rounded-m3-full font-medium tracking-wide",
          card: "shadow-m3-2 rounded-m3-lg border ff-hairline bg-surface-container-low",
          headerTitle: "font-brand text-2xl font-semibold tracking-tight",
        },
      }}
    >
      <NowProvider>
        <FallbackBanner />
        <ClerkKeyGuard />
        <Shell>{children}</Shell>
        <Toaster
          position="bottom-right"
          theme="light"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast:
                "rounded-m3-md border ff-hairline shadow-m3-2 md-surface-container-low text-on-surface",
              title: "md-typescale-label-large",
              description: "md-typescale-body-small text-on-surface-variant",
            },
          }}
        />
      </NowProvider>
    </ClerkProvider>
  );
}
