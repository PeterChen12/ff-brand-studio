#!/usr/bin/env node
// Stop hook · "hard queue" inbox.
//
// After every Claude turn, look for the next markdown file in inbox/
// (alphabetical = FIFO when files are timestamp- or counter-prefixed).
// If one exists, move it to inbox/processed/ and feed its contents back
// to Claude as the next instruction by emitting `{decision: "block",
// reason: "..."}` and exit code 2.
//
// Usage: drop files like inbox/001-write-phase-J-plan.md while Claude
// is running. Files survive restarts. Edit-friendly. True FIFO.
//
// Source: pattern provided by the user 2026-04-27.

import { readdirSync, readFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Read the Stop event JSON from stdin so we can honor stop_hook_active
// (Claude Code sets this when re-entering the hook chain after a block,
// which would otherwise cause an infinite loop).
let input = "";
for await (const chunk of process.stdin) input += chunk;

let event = {};
try {
  event = JSON.parse(input);
} catch {
  // No event payload — fall through and check the inbox anyway.
}

// Critical: never block when re-entering after our own block decision.
if (event.stop_hook_active) {
  process.exit(0);
}

const projectRoot = process.cwd();
const inboxDir = join(projectRoot, "inbox");
const processedDir = join(inboxDir, "processed");

if (!existsSync(inboxDir)) process.exit(0);
if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

const files = readdirSync(inboxDir)
  .filter((f) => f.endsWith(".md") && !f.startsWith("."))
  .sort(); // alphabetical = FIFO when files are prefixed with 001-, 002- …

if (files.length === 0) {
  process.exit(0); // nothing queued, let Claude stop normally
}

const next = files[0];
const content = readFileSync(join(inboxDir, next), "utf8");

// Move to processed so we never re-read it.
renameSync(join(inboxDir, next), join(processedDir, next));

// Feed the queued task back to Claude as the next instruction.
process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason: `Next queued task from inbox/${next}:\n\n${content}`,
  })
);
process.exit(2);
