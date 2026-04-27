import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/layout/shell";
import { M3Register } from "@/components/m3-register";

export const metadata: Metadata = {
  title: "FF Brand Studio · Listing Ops",
  description:
    "High-quality product images and description generation at scale — for marketing agencies serving Chinese sellers on Amazon US and Shopify DTC.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <M3Register />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
