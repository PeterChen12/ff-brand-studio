"use client";

import { useState } from "react";
import { SignIn } from "@clerk/react";

export default function SignInPage() {
  // Backup access stays hidden until the user explicitly asks for it — it's a
  // last-resort escape hatch (Clerk down / Google OAuth misconfig), not a
  // primary path, so it shouldn't compete with the real sign-in box.
  const [showBackup, setShowBackup] = useState(false);

  return (
    <div className="min-h-screen md-surface flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="font-brand text-[3rem] font-semibold leading-none tracking-tight">
            FF
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full bg-primary translate-y-[-8px] ml-2"
            />
          </div>
          <div className="md-typescale-title-medium text-on-surface-variant mt-1">
            Brand Studio
          </div>
          <div className="md-typescale-label-small text-on-surface-variant/70 mt-3 tracking-stamp uppercase">
            Sign in · 登录
          </div>
        </div>
        <SignIn
          routing="hash"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/"
        />
        {/* Subtle, collapsed-by-default escape hatch. Revealed only on click so
            the backup key path is discoverable without cluttering the page. */}
        <div className="mt-5 text-center">
          {!showBackup ? (
            <button
              type="button"
              onClick={() => setShowBackup(true)}
              className="md-typescale-body-small text-on-surface-variant/70 hover:text-on-surface underline underline-offset-4 decoration-dotted transition-colors"
            >
              Trouble signing in?
            </button>
          ) : (
            <p className="md-typescale-body-small text-on-surface-variant/80">
              Use a{" "}
              <a
                href="/backup"
                className="text-primary hover:underline font-medium"
              >
                backup access key
              </a>{" "}
              instead — works even when Clerk is down.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
