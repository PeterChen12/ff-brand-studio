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
      </div>
    </div>
  );
}
