import type { NextConfig } from "next";

const config: NextConfig = {
  // Static export — all pages prerendered, all data fetched client-side from the Worker.
  // Lets us deploy to Cloudflare Pages without Node runtime.
  output: "export",
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
    ],
  },
};

export default config;
