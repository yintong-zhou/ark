// Ark status line wrapper for Claude Code.
// Installed at <userData>/statusline-wrapper.cjs and run by Claude Code as the statusLine command.
// Contract: it must NEVER break the user's status line. Every step that can fail is isolated,
// and the user's original command always runs with the same stdin, its stdout passed through.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = __dirname;
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks).toString('utf8');
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    payload = undefined; // not JSON: nothing to forward to Ark, the original still runs
  }

  // 1. Forward the payload to Ark: one file per session, written atomically (tmp + rename).
  //    The id becomes a filename, so only a strict charset is accepted (no path traversal).
  try {
    const id = payload && payload.session_id;
    if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      const out = path.join(dir, 'claude', 'sessions');
      fs.mkdirSync(out, { recursive: true });
      const file = path.join(out, id + '.json');
      fs.writeFileSync(file + '.tmp', input);
      fs.renameSync(file + '.tmp', file);
    }
  } catch {
    // Ark's drop dir is unavailable: skip forwarding, never fail the status line.
  }

  // 2. Run the user's original status line, or print a minimal one when there was none.
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(path.join(dir, 'statusline-original.json'), 'utf8')) || {};
  } catch {
    state = {};
  }
  const original = typeof state.originalCommand === 'string' ? state.originalCommand : '';
  // Guard against wrapping ourselves (a stale Ark command recorded as "original"): never recurse.
  const nested = process.env.ARK_STATUSLINE_WRAPPER === '1';
  try {
    if (original && !nested) {
      const r = spawnSync(original, {
        input,
        shell: pickShell(state.shell),
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env, ARK_STATUSLINE_WRAPPER: '1' },
      });
      process.stdout.write(r.stdout || '');
    } else if (payload) {
      process.stdout.write(minimalLine(payload) + '\n');
    }
  } catch {
    // Nothing sensible left to print.
  }
  process.exit(0);
});

/**
 * Run the original in the shell Claude Code uses (Git Bash on Windows), recorded at Connect.
 * Fallbacks: a SHELL that exists as a Windows path, then cmd.exe.
 */
function pickShell(recorded) {
  if (typeof recorded === 'string' && fs.existsSync(recorded)) return recorded;
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) return process.env.SHELL;
  return true;
}

function minimalLine(p) {
  const pct = (v) => (typeof v === 'number' ? Math.round(v) + '%' : null);
  const rl = p.rate_limits || {};
  const parts = [
    p.model && p.model.display_name,
    pct(p.context_window && p.context_window.used_percentage) && 'ctx ' + pct(p.context_window.used_percentage),
    pct(rl.five_hour && rl.five_hour.used_percentage) && '5h ' + pct(rl.five_hour.used_percentage),
    pct(rl.seven_day && rl.seven_day.used_percentage) && 'wk ' + pct(rl.seven_day.used_percentage),
  ];
  return parts.filter(Boolean).join(' · ');
}
