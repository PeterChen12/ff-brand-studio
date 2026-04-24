import type { NextConfig } from "next";

const config: NextConfig = {
  // Note: no output: "standalone" — Amplify uses its own SSR packager, and standalone
  // requires symlink perms that Windows dev lacks without admin rights.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.cloudflare.com" },
    ],
  },
};

export default config;
