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
        {/* Prominent escape hatch. Google/Clerk sign-in is fragile (e.g.
            Google OAuth "Missing client_id" when the prod Clerk instance has
            no Google app configured), so during internal testing the backup
            key is the reliable way in. Make it a real button, not a footnote. */}
        <div className="mt-6 rounded-m3-lg border ff-hairline bg-surface-container-low p-4 text-center">
          <p className="md-typescale-body-small text-on-surface-variant mb-3">
            Sign-in not working? (e.g. Google login error) — use a backup
            access key instead. It works even when Clerk is down.
          </p>
          <a
            href="/backup"
            className="inline-block rounded-m3-full bg-primary px-5 py-2.5 font-medium tracking-wide text-on-primary hover:opacity-90"
          >
            Backup access · 应急通道
          </a>
        </div>
      </div>
    </div>
  );
}
