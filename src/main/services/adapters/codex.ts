import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join, win32 } from 'node:path';
import type { Session, UsageWindow } from '@shared/types';
import { detect } from '../exec';
import { num, obj, str } from '../json';
import { readCodexAccount, readCodexRateLimits } from './codex-appserver';
import type { Adapter, AdapterUpdate } from './types';

const BASELINE_TOKENS = 12000; // Codex reserves this for its own prompt (codex-rs protocol TokenUsage)
const SCAN_DAYS = 8; // date dirs to look at: the last 7 days plus today
const LIVE_MS = 30 * 60e3; // only files touched in the last 30 min are tailed
const TAIL_BYTES = 1024 * 1024;

/** Context used %, as Codex computes it: 100 − percent_of_context_window_remaining(window). */
export function codexContextPct(used: number, window: number): number {
  if (window <= BASELINE_TOKENS) return 100;
  const effective = window - BASELINE_TOKENS;
  const remaining = Math.max(0, effective - Math.max(0, used - BASELINE_TOKENS));
  return 100 - Math.min(100, Math.max(0, Math.round((remaining / effective) * 100)));
}

/** Map rollout lines (session_meta first, then any tail) to a session and account windows. */
export function parseRollout(lines: string[], seenAt: number): { session?: Session; windows: UsageWindow[] } {
  let id: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let info: Record<string, unknown> | undefined;
  let rl: Record<string, unknown> | undefined;
  for (const line of lines) {
    let o: Record<string, unknown> | undefined;
    try {
      o = obj(JSON.parse(line));
    } catch {
      continue; // a line Codex is still writing
    }
    const p = obj(o?.payload);
    if (!o || !p) continue;
    if (o.type === 'session_meta') {
      id = str(p.id) ?? id;
      cwd = str(p.cwd) ?? cwd;
    } else if (o.type === 'turn_context') {
      model = str(p.model) ?? model;
      cwd ??= str(p.cwd);
    } else if (o.type === 'event_msg' && p.type === 'token_count') {
      info = obj(p.info) ?? info;
      rl = obj(p.rate_limits) ?? rl;
    }
  }

  const windows: UsageWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const w = obj(rl?.[key]);
    const usedPct = num(w?.used_percent);
    const minutes = num(w?.window_minutes);
    const resetsAt = num(w?.resets_at);
    if (usedPct !== undefined && minutes !== undefined && resetsAt !== undefined) windows.push({ usedPct, resetsAt, minutes });
  }
  if (!id) return { windows };

  const contextSize = num(info?.model_context_window);
  const contextUsed = num(obj(info?.last_token_usage)?.total_tokens);
  const session: Session = {
    id,
    agent: 'codex',
    project: win32.basename(cwd ?? ''),
    cwd: cwd ?? '',
    model,
    contextSize,
    contextUsed,
    tokens: num(obj(info?.total_token_usage)?.total_tokens),
    contextPct: contextSize !== undefined && contextUsed !== undefined ? codexContextPct(contextUsed, contextSize) : undefined,
    lastSeen: seenAt,
  };
  return { session, windows };
}

function readRange(file: string, start: number, end: number): string {
  if (end <= start) return '';
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** The session_meta line: read in chunks until the first newline (it can be large). */
function readFirstLine(file: string, size: number): string {
  let text = '';
  for (let pos = 0; pos < size && pos < 16 * TAIL_BYTES; pos += 64 * 1024) {
    text += readRange(file, pos, Math.min(size, pos + 64 * 1024));
    const i = text.indexOf('\n');
    if (i >= 0) return text.slice(0, i);
  }
  return text;
}

type Tracked = { offset: number; context: string[] }; // context = [session_meta, last turn_context]

/** Reads Codex rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl), read-only. */
export function createCodexAdapter(opts: {
  sessionsDir: string;
  codexPath?: string;
  pollMs?: number;
  now?: () => number;
}): Adapter {
  const now = opts.now ?? Date.now;
  const tracked = new Map<string, Tracked>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let codexPath = opts.codexPath;
  const path = async () => (codexPath ??= (await detect('codex')).path);

  /** rollout files in the date dirs of the last SCAN_DAYS days, with their stats. */
  const listFiles = () => {
    const out: { file: string; size: number; mtime: number }[] = [];
    for (let i = 0; i < SCAN_DAYS; i++) {
      const d = new Date(now() - i * 86400e3);
      const dir = join(opts.sessionsDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
        const file = join(dir, name);
        const st = statSync(file);
        out.push({ file, size: st.size, mtime: st.mtimeMs });
      }
    }
    return out;
  };

  /** First sight of a file: session_meta + the last 1 MB (its first, partial line dropped). */
  const ingest = (file: string, size: number, mtime: number, emit: (u: AdapterUpdate) => void) => {
    const head = readFirstLine(file, size);
    const tailStart = Math.max(head.length + 1, size - TAIL_BYTES);
    let tail = readRange(file, tailStart, size).split('\n');
    if (tailStart > head.length + 1) tail = tail.slice(1);
    const end = tail.pop() ?? ''; // incomplete last line: re-read on the next poll
    const lastTurn = [...tail].reverse().find((l) => l.includes('"turn_context"'));
    tracked.set(file, { offset: size - Buffer.byteLength(end), context: lastTurn ? [head, lastTurn] : [head] });
    const r = parseRollout([head, ...tail], mtime);
    if (r.session) emit({ agent: 'codex', session: r.session, windows: r.windows });
  };

  const poll = (emit: (u: AdapterUpdate) => void) => {
    for (const { file, size, mtime } of listFiles()) {
      const t = tracked.get(file);
      if (!t) {
        if (now() - mtime < LIVE_MS) ingest(file, size, mtime, emit);
        continue;
      }
      if (size <= t.offset || now() - mtime > LIVE_MS) continue;
      const chunk = readRange(file, t.offset, size);
      const cut = chunk.lastIndexOf('\n');
      if (cut < 0) continue; // only a partial line so far
      t.offset += Buffer.byteLength(chunk.slice(0, cut + 1));
      const lines = chunk.slice(0, cut).split('\n');
      const turn = [...lines].reverse().find((l) => l.includes('"turn_context"'));
      if (turn) t.context = [t.context[0], turn];
      if (!lines.some((l) => l.includes('"token_count"') || l.includes('"turn_context"'))) continue;
      const r = parseRollout([...t.context, ...lines], now());
      if (r.session) emit({ agent: 'codex', session: r.session, windows: r.windows });
    }
  };

  return {
    id: 'codex',
    detect: async () => {
      const d = await detect('codex');
      codexPath = d.path;
      return d;
    },
    account: async () => {
      const p = await path();
      return p ? readCodexAccount(p) : undefined;
    },
    refresh: async () => {
      const p = await path();
      return p ? readCodexRateLimits(p) : [];
    },
    async start(emit) {
      if (!existsSync(opts.sessionsDir)) return;
      for (const { file, size, mtime } of listFiles()) ingest(file, size, mtime, emit);
      timer = setInterval(() => {
        try {
          poll(emit);
        } catch {
          // a file vanished or is locked mid-poll: try again next tick
        }
      }, opts.pollMs ?? 5000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
