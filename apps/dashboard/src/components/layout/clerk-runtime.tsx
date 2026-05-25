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

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// Defensive guard — a previous deploy regression silently shipped a
// `pk_test_*` Clerk publishable key to production, where it hit the
// dev-instance rate limits (max 2 orgs, JWT mint throttling) and
// caused user uploads to look "stuck" with no surface error. Catch
// it at runtime so the same regression never goes unnoticed again.
const IS_DEV_CLERK_KEY = PUBLISHABLE_KEY.startsWith("pk_test_");
const IS_PROD_HOSTNAME =
  typeof window !== "undefined" &&
  !window.location.hostname.includes("localhost") &&
  !window.location.hostname.includes("127.0.0.1") &&
  !window.location.hostname.endsWith(".local");

function ClerkKeyGuard() {
  useEffect(() => {
    if (IS_DEV_CLERK_KEY && IS_PROD_HOSTNAME) {
      // Loud console error in addition to the visible banner — operator
      // tooling that scrapes console logs will pick this up.
      // eslint-disable-next-line no-console
      console.error(
        "[clerk-key-guard] Production deploy is using a pk_test_* Clerk key. " +
          "Clerk dev instances have strict rate limits + 2-org cap; user " +
          "uploads will appear stuck. Rotate NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY " +
          "to a pk_live_* key from Clerk's production instance and redeploy."
      );
    }
  }, []);

  if (!IS_DEV_CLERK_KEY || !IS_PROD_HOSTNAME) return null;
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
      ⚠ This deploy is using a Clerk DEVELOPMENT key (pk_test_*) — uploads
      may appear stuck due to dev-instance rate limits. Rotate{" "}
      <code style={{ background: "rgba(0,0,0,0.15)", padding: "1px 6px", borderRadius: 3 }}>
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
      </code>{" "}
      to a <code>pk_live_*</code> key and redeploy.
    </div>
  );
}

export function ClerkRuntime({ children }: { children: React.ReactNode }) {
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
