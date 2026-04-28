"use client";
import dynamic from "next/dynamic";

// Phase G — page content is dynamic({ssr:false}) so its @clerk/react
// import chain never loads during the static-export prerender pass. See
// `components/layout/clerk-app-shell.tsx` for the full rationale.
const Inner = dynamic(() => import("./_overview-client"), { ssr: false });

export default function OverviewPage() {
  return <Inner />;
}
