#!/usr/bin/env node
// Enforces single-step discipline: if a step is IN_PROGRESS and tests haven't
// passed, block the stop. If finished cleanly, allow stop.

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  let event = {};
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // CRITICAL: prevent infinite loops
  if (event.stop_hook_active) {
    process.exit(0);
  }

  const planPath = path.join(process.cwd(), 'plans', 'active-plan.md');
  if (!fs.existsSync(planPath)) {
    process.exit(0);
  }

  const plan = fs.readFileSync(planPath, 'utf8');
  const inProgress = plan.match(/### Step ([\d.]+).*?\n- \*\*Status:\*\* IN_PROGRESS/s);

  if (inProgress) {
    const transcriptPath = event.transcript_path;
    let claimsDone = false;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const transcript = fs.readFileSync(transcriptPath, 'utf8');
      const lastTurn = transcript.split('\n').slice(-200).join('\n');
      claimsDone =
        /step \d+\.\d+ complete/i.test(lastTurn) ||
        /ready to \/review/i.test(lastTurn) ||
        /STEP_COMPLETE/i.test(lastTurn);
    }

    if (!claimsDone) {
      console.log(
        JSON.stringify({
          decision: 'block',
          reason: `Step ${inProgress[1]} is IN_PROGRESS but completion was not confirmed. Run the test command, meet acceptance criteria, then respond with "Step ${inProgress[1]} complete. Run /review to verify."`,
        })
      );
      process.exit(0);
    }
  }

  // Clean stop — allow
  process.exit(0);
});
