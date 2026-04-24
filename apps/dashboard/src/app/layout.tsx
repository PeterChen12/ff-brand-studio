import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FF Brand Studio",
  description: "Faraday Future AI-powered bilingual content generation dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav
          style={{
            background: "#0d1b4b",
            borderBottom: "1px solid #1c3faa",
            padding: "0 24px",
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 32,
          }}
        >
          <span style={{ color: "#c9a84c", fontWeight: 700, letterSpacing: 2, fontSize: 13 }}>
            FF BRAND STUDIO
          </span>
          <a href="/" style={{ color: "#9ca3af", fontSize: 14 }}>
            Dashboard
          </a>
          <a href="/campaigns/new" style={{ color: "#c9a84c", fontSize: 14, fontWeight: 600 }}>
            + New Campaign
          </a>
          <a href="/assets" style={{ color: "#9ca3af", fontSize: 14 }}>
            Asset Library
          </a>
          <a href="/costs" style={{ color: "#9ca3af", fontSize: 14 }}>
            Cost Tracker
          </a>
        </nav>
        <main style={{ minHeight: "calc(100vh - 56px)", padding: "32px 24px" }}>{children}</main>
      </body>
    </html>
  );
}
