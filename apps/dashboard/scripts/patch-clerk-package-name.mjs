#!/usr/bin/env node
/**
 * Clerk SDK bug workaround — fixes broken
 * `r7.setPackageName({packageName})` shorthand in compiled chunks.
 *
 * The minified bundle inlines a literal `{packageName}` shorthand
 * referencing an undefined identifier. At runtime this throws
 * `ReferenceError: packageName is not defined` and crashes the
 * dashboard before any UI mounts.
 *
 * Bug observed in @clerk/clerk-react 5.61.3 + 5.61.6 AND @clerk/react
 * 6.4.5 (same minifier pattern carried over after the v6 rename).
 * Vendor fix would be one character; Phase R follow-up to drop this
 * patch once Clerk ships the upstream fix.
 *
 * The replacement injects the literal package name string. Pattern is
 * unique to Clerk's IIFE so collateral damage is zero. Runs as
 * `postbuild` in apps/dashboard/package.json. Safe to re-run.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const chunkDir = join(__dirname, "..", "out", "_next", "static", "chunks");

if (!existsSync(chunkDir)) {
  console.log(`[patch-clerk] no chunks dir at ${chunkDir} — skipping`);
  process.exit(0);
}

// Match `<id>.setPackageName({packageName})` where <id> is a JS identifier
// and the {packageName} object literal is the broken shorthand. The
// replacement injects the literal package name string so the call
// is well-formed at runtime.
const BROKEN = /(\b[a-zA-Z_$][\w$]*)\.setPackageName\(\{packageName\}\)/g;
const FIXED = (_m, ident) => `${ident}.setPackageName({packageName:"@clerk/react"})`;

let totalFiles = 0;
let totalReplacements = 0;
const visit = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(p);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    totalFiles++;
    const src = readFileSync(p, "utf8");
    if (!BROKEN.test(src)) continue;
    BROKEN.lastIndex = 0; // reset stateful regex
    const before = (src.match(BROKEN) ?? []).length;
    const out = src.replace(BROKEN, FIXED);
    writeFileSync(p, out);
    totalReplacements += before;
    console.log(`[patch-clerk] ${entry.name}: replaced ${before} occurrence(s)`);
  }
};
visit(chunkDir);

console.log(
  `[patch-clerk] scanned ${totalFiles} chunk(s); fixed ${totalReplacements} broken setPackageName call(s)`
);
