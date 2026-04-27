"use client";

import { SignUp } from "@clerk/clerk-react";

export default function SignUpPage() {
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
            Create account · 注册
          </div>
          <div className="md-typescale-body-small text-on-surface-variant/60 mt-4 max-w-xs mx-auto">
            Every new agency gets <span className="text-primary font-medium">$5 in credit</span> —
            roughly 10 product launches.
          </div>
        </div>
        <SignUp
          routing="hash"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/"
        />
      </div>
    </div>
  );
}
