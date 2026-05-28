"use client";

import { SignIn } from "@clerk/react";

export default function SignInPage() {
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
        {/* Discoverable escape hatch: a user who can't sign in (Clerk down,
            forgot password, rate-limited, etc.) can hit /backup and paste
            their ff_live_ key. This link is the only way most users will
            ever learn the route exists, so keep it visible but not noisy. */}
        <p className="mt-6 text-center md-typescale-body-small text-on-surface-variant/70">
          Having trouble?{" "}
          <a
            href="/backup"
            className="text-primary hover:underline font-medium"
          >
            Use backup access
          </a>
        </p>
      </div>
    </div>
  );
}
