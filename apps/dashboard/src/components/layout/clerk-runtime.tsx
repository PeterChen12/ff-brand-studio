"use client";

/**
 * Browser-only Clerk runtime — loaded via next/dynamic({ ssr: false })
 * from clerk-app-shell.tsx so the @clerk/react module is never
 * imported during prerender. See clerk-app-shell.tsx for the rationale.
 */

import { ClerkProvider } from "@clerk/react";
import { Shell } from "@/components/layout/shell";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

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
      <Shell>{children}</Shell>
    </ClerkProvider>
  );
}
