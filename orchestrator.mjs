#!/usr/bin/env node
// orchestrator.mjs — overnight autonomous runner for plans/active-plan.md
// Usage:
//   MAX_ITERATIONS=6 MAX_MINUTES=480 MAX_USD=15 node orchestrator.mjs
//
// Windows detached launch (PowerShell):
//   $env:MAX_ITERATIONS=6; $env:MAX_MINUTES=480; $env:MAX_USD=15
//   Start-Process node -ArgumentList "orchestrator.mjs" -WindowStyle Hidden
//   -RedirectStandardOutput orchestrator.out -NoNewWindow:$false
//
// Windows keep-alive (prevent sleep while running):
//   powercfg /requestsoverride PROCESS node.exe SYSTEM
//
// Git Bash / WSL detached launch:
//   MAX_ITERATIONS=6 MAX_MINUTES=480 MAX_USD=15 \
//     nohup node orchestrator.mjs > orchestrator.out 2>&1 &

import { spawn } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ─────────────────────────── CONFIG ───────────────────────────
const CAPS = {
  maxIterations: Number(process.env.MAX_ITERATIONS ?? 6),
  maxMinutes: Number(process.env.MAX_MINUTES ?? 480),
  maxUsd: Number(process.env.MAX_USD ?? 15),
  perStepMin: Number(process.env.PER_STEP_MIN ?? 30),
};

const PLAN_PATH = 'plans/active-plan.md';
const LOG_PATH = `logs/autonomous-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
const IS_WINDOWS = process.platform === 'win32';
const startedAt = Date.now();
let spentUsd = 0;
let stepsDone = 0;
let consecutiveBlocked = 0;

// ─────────────────────────── HELPERS ──────────────────────────
const log = async (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  await appendFile(LOG_PATH, line).catch(() => {});
};

const sh = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, timeoutMs);
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });

// Cross-platform shell runner for test commands
const runShell = (cmd, timeoutMs) => {
  if (IS_WINDOWS) {
    return sh('cmd', ['/c', cmd], timeoutMs);
  }
  return sh('bash', ['-c', cmd], timeoutMs);
};

const budgetOk = () => {
  if (stepsDone >= CAPS.maxIterations) return 'hit maxIterations cap';
  if ((Date.now() - startedAt) / 60000 > CAPS.maxMinutes) return 'hit maxMinutes cap';
  if (spentUsd >= CAPS.maxUsd) return 'hit maxUsd cap';
  return null;
};

// ─────────────────────────── PLAN PARSING ─────────────────────
// Step block format:
//   ### Step 2.2 — Wire up fal.ai tool
//   - **Status:** PENDING
//   - **Autonomous:** YES
//   - **Test:** `pnpm --filter ff-mcp-server run type-check`
function parseSteps(plan) {
  const blocks = plan.split(/\n(?=### Step )/).slice(1);
  return blocks.map((b) => {
    const id = (b.match(/### Step ([\d.]+)/) || [])[1];
    const title = (b.match(/### Step [\d.]+ — (.+)/) || [])[1] || '';
    const status = (b.match(/\*\*Status:\*\*\s*(\w+)/) || [])[1];
    const auto = /\*\*Autonomous:\*\*\s*YES/.test(b);
    const test = (b.match(/\*\*Test:\*\*\s*`?([^`\n]+)`?/) || [])[1]?.trim();
    return { id, title, status, auto, test, raw: b };
  });
}

async function updateStepStatus(id, newStatus) {
  const plan = await readFile(PLAN_PATH, 'utf8');
  const escaped = id.replace('.', '\\.');
  const re = new RegExp(
    `(### Step ${escaped} — [^\\n]*\\n- \\*\\*Status:\\*\\* )\\w+`
  );
  await writeFile(PLAN_PATH, plan.replace(re, `$1${newStatus}`));
}

// ─────────────────────────── ONE STEP CYCLE ───────────────────
async function runStep(step) {
  await log(`▶ Step ${step.id} — ${step.title}`);
  await updateStepStatus(step.id, 'IN_PROGRESS');

  const prompt = `Read plans/active-plan.md, find Step ${step.id} ("${step.title}"), and execute ONLY that step.
Follow every rule in CLAUDE.md. Do not touch any other step.
When done, run the test command: ${step.test}
If the test passes, respond with exactly the string: STEP_COMPLETE
If the test fails after 3 honest attempts, respond with exactly: STEP_BLOCKED: <one-line reason>
Do not respond with anything else.`.trim();

  const r = await sh(
    'claude',
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      'sonnet',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Write,Edit,Bash,Glob,Grep',
    ],
    CAPS.perStepMin * 60 * 1000
  );

  if (r.code !== 0) {
    await log(`  ✗ claude subprocess failed (exit ${r.code}): ${r.err.slice(0, 200)}`);
    await sh('git', ['reset', '--hard'], 30_000);
    await updateStepStatus(step.id, 'BLOCKED');
    return 'BLOCKED';
  }

  let parsed = {};
  try {
    parsed = JSON.parse(r.out);
  } catch {
    parsed = { result: r.out, cost_usd: 0 };
  }

  const cost = parsed.cost_usd ?? parsed.total_cost_usd ?? 0;
  spentUsd += cost;

  const claimed = (parsed.result || r.out || '').toUpperCase();

  if (claimed.includes('STEP_COMPLETE')) {
    // Verify independently — never trust the agent's own claim
    const verify = await runShell(step.test, 5 * 60 * 1000);
    if (verify.code === 0) {
      await sh('git', ['add', '-A'], 10_000);
      const msg = `feat(auto): step ${step.id} — ${step.title}`;
      await sh('git', ['commit', '-m', msg], 10_000);
      await updateStepStatus(step.id, 'DONE');
      await log(`  ✓ Step ${step.id} DONE (~$${cost.toFixed(3)} this step, $${spentUsd.toFixed(2)} total)`);
      stepsDone++;
      return 'DONE';
    }
    await log(`  ✗ Agent claimed STEP_COMPLETE but verify test failed: ${verify.err.slice(0, 200)}`);
  } else {
    await log(`  ✗ Agent did not claim completion. Response: ${claimed.slice(0, 120)}`);
  }

  await sh('git', ['reset', '--hard'], 30_000);
  await updateStepStatus(step.id, 'BLOCKED');
  return 'BLOCKED';
}

// ─────────────────────────── MAIN LOOP ────────────────────────
(async () => {
  await mkdir('logs', { recursive: true });
  await log(`▣ Autonomous run starting. Caps: ${JSON.stringify(CAPS)}`);
  await log(`▣ Platform: ${process.platform}, shell: ${IS_WINDOWS ? 'cmd.exe' : 'bash'}`);

  // Safety: refuse to run on main/master
  const branchResult = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 5_000);
  const branch = branchResult.out.trim();
  if (branch === 'main' || branch === 'master') {
    await log('✗ Refusing to run on main/master. Create an autonomous/* branch first:');
    await log('  git checkout -b autonomous/YYYY-MM-DD');
    process.exit(1);
  }
  await log(`▣ Branch: ${branch}`);

  // Check claude CLI is available
  const claudeCheck = await sh('claude', ['--version'], 5_000);
  if (claudeCheck.code !== 0) {
    await log('✗ claude CLI not found in PATH. Install Claude Code first.');
    process.exit(1);
  }
  await log(`▣ Claude CLI: ${claudeCheck.out.trim()}`);

  while (true) {
    const capHit = budgetOk();
    if (capHit) {
      await log(`⏹ Stopping: ${capHit}`);
      break;
    }

    const plan = await readFile(PLAN_PATH, 'utf8');
    const steps = parseSteps(plan);
    const next = steps.find((s) => s.status === 'PENDING' && s.auto && s.test);

    if (!next) {
      await log('⏹ No more autonomous-flagged PENDING steps. Run complete.');
      break;
    }

    const result = await runStep(next);

    if (result === 'BLOCKED') {
      consecutiveBlocked++;
      await log(`  ⚠ Consecutive BLOCKED count: ${consecutiveBlocked}`);
      if (consecutiveBlocked >= 2) {
        await log('⏹ Two consecutive BLOCKED steps — something is wrong. Stopping to prevent cascade.');
        await log('  Fix the issue, then re-run the orchestrator.');
        break;
      }
      await log('  Continuing to next step after BLOCKED...');
    } else {
      consecutiveBlocked = 0;
    }
  }

  const elapsed = ((Date.now() - startedAt) / 60000).toFixed(0);
  await log(
    `▣ Run complete. ${stepsDone} step(s) DONE. ~$${spentUsd.toFixed(2)} spent. ${elapsed} min elapsed.`
  );
  await log('');
  await log('Morning review commands:');
  await log(`  tail -n 80 ${LOG_PATH} | grep -E "▶|✓|✗|⏹"`);
  await log(`  git log ${branch} --oneline --since="12 hours ago"`);
  await log(`  grep -B 1 -A 3 BLOCKED ${LOG_PATH}`);
  await log('  pnpm type-check && pnpm build');
})();
