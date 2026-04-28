"use client";
import dynamic from "next/dynamic";

const Inner = dynamic(() => import("./_client"), { ssr: false });

export default function SettingsPage() {
  return <Inner />;
}
