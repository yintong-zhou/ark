import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { join, win32 } from 'node:path';
import type { Account, Session, UsageWindow } from '@shared/types';
import { detect, run } from '../exec';
import { num, obj, str } from '../json';
import type { Adapter } from './types';

const PRUNE_MS = 30 * 86400e3;
const WINDOWS: [key: string, minutes: number][] = [
  ['five_hour', 300],
  ['seven_day', 10080],
];

/** Map one Claude Code status line payload to a session plus account windows. */
export function parseStatusline(raw: unknown, seenAt: number): { session: Session; windows: UsageWindow[] } | undefined {
  const p = obj(raw);
  const id = str(p?.session_id);
  if (!p || !id) return undefined;
  const ws = obj(p.workspace);
  const cwd = str(p.cwd) ?? str(ws?.current_dir) ?? '';
  const ctx = obj(p.context_window);
  const size = num(ctx?.context_window_size);
  const pct = num(ctx?.used_percentage);
  const session: Session = {
    id,
    agent: 'claude',
    project: win32.basename(str(ws?.project_dir) ?? cwd),
    cwd,
    model: str(obj(p.model)?.display_name),
    contextSize: size,
    contextPct: pct,
    contextUsed: size !== undefined && pct !== undefined ? Math.round((pct / 100) * size) : undefined,
    costUsd: num(obj(p.cost)?.total_cost_usd),
    lastSeen: seenAt,
  };
  // rate_limits is absent before the first response, on API keys, and on non Pro/Max plans.
  const rl = obj(p.rate_limits);
  const windows: UsageWindow[] = [];
  for (const [key, minutes] of WINDOWS) {
    const w = obj(rl?.[key]);
    const usedPct = num(w?.used_percentage);
    const resetsAt = num(w?.resets_at);
    if (usedPct !== undefined && resetsAt !== undefined) windows.push({ usedPct, resetsAt, minutes });
  }
  return { session, windows };
}

export function parseAuthStatus(raw: unknown): { account: Account; configDir?: string } {
  const p = obj(raw) ?? {};
  const authMethod = str(p.authMethod) ?? '';
  const method = authMethod === 'claude.ai' ? 'subscription' : /api/i.test(authMethod) ? 'apiKey' : 'unknown';
  return {
    account: { loggedIn: p.loggedIn === true, method, email: str(p.email), plan: str(p.subscriptionType) },
    configDir: str(p.configDirectory),
  };
}

/** `claude auth status` prints JSON; it carries the account and the config directory (for settings.json). */
export async function claudeAuth(): Promise<{ account: Account; configDir?: string } | undefined> {
  const { path } = await detect('claude');
  if (!path) return undefined;
  const r = await run(path, ['auth', 'status']);
  try {
    return parseAuthStatus(JSON.parse(r.stdout));
  } catch {
    return undefined;
  }
}

/** Reads the payloads the status line wrapper drops into dropDir (one file per session). */
export function createClaudeAdapter(opts: { dropDir: string; now?: () => number }): Adapter {
  const now = opts.now ?? Date.now;
  let watcher: FSWatcher | undefined;

  const read = (file: string, seenAt: number) => {
    try {
      return parseStatusline(JSON.parse(readFileSync(file, 'utf8')), seenAt);
    } catch {
      return undefined; // mid-write or garbage: the next status line update will bring it back
    }
  };

  return {
    id: 'claude',
    detect: () => detect('claude'),
    account: async () => (await claudeAuth())?.account,
    refresh: async () => [],
    async start(emit) {
      mkdirSync(opts.dropDir, { recursive: true });
      for (const name of readdirSync(opts.dropDir)) {
        if (!name.endsWith('.json')) continue;
        const file = join(opts.dropDir, name);
        const mtime = statSync(file).mtimeMs;
        if (now() - mtime > PRUNE_MS) {
          unlinkSync(file);
          continue;
        }
        const r = read(file, mtime);
        if (r) emit({ agent: 'claude', ...r });
      }
      // The wrapper writes <id>.json.tmp then renames, so only *.json names are complete files.
      watcher = watch(opts.dropDir, (_event, name) => {
        if (!name?.endsWith('.json')) return;
        const r = read(join(opts.dropDir, name), now());
        if (r) emit({ agent: 'claude', ...r });
      });
    },
    stop() {
      watcher?.close();
      watcher = undefined;
    },
  };
}
