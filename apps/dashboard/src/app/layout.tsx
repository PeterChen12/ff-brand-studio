import type { Metadata } from "next";
import "./globals.css";
import { ClerkAppShell } from "@/components/layout/clerk-app-shell";

export const metadata: Metadata = {
  title: "FF Brand Studio · Listing Ops",
  description:
    "High-quality product images and description generation at scale — for marketing agencies serving Chinese sellers on Amazon US and Shopify DTC.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkAppShell>{children}</ClerkAppShell>
      </body>
    </html>
  );
}
