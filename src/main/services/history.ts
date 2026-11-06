import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentId, AgentStatus, HistoryDay, Session } from '@shared/types';

const THROTTLE_MS = 5 * 60e3;
const PRUNE_MS = 30 * 86400e3;
const DAYS = 7;

type AgentLine = { kind: 'agent'; t: number; agent: AgentId; fiveHourPct?: number; weeklyPct?: number };
type SessionLine = {
  kind: 'session'; t: number; agent: AgentId; id: string; project: string;
  contextPct?: number; tokens?: number; costUsd?: number;
};
type Line = AgentLine | SessionLine;

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Append-only JSONL log of usage snapshots in <userData>/history.jsonl. Recorded only while Ark runs. */
export class HistoryStore {
  private lastWrite = new Map<string, { t: number; key: string }>();

  constructor(
    private file: string,
    private now: () => number = Date.now,
  ) {}

  /** `at` is when the reading was taken (a file ingested at startup is older than now). */
  recordAgent(a: AgentStatus, at: number = this.now()): void {
    const line: AgentLine = { kind: 'agent', t: at, agent: a.id, fiveHourPct: a.fiveHour?.usedPct, weeklyPct: a.weekly?.usedPct };
    this.write(`agent:${a.id}`, JSON.stringify([line.fiveHourPct, line.weeklyPct]), line);
  }

  recordSession(s: Session, at: number = this.now()): void {
    const line: SessionLine = {
      kind: 'session', t: at, agent: s.agent, id: s.id, project: s.project,
      contextPct: s.contextPct, tokens: s.tokens, costUsd: s.costUsd,
    };
    this.write(`session:${s.agent}:${s.id}`, JSON.stringify([line.contextPct, line.tokens, line.costUsd]), line);
  }

  // ponytail: changes inside the 5-min throttle are dropped, a peak can be missed by ≤5 min; buffer the latest value if that matters.
  private write(slot: string, key: string, line: Line) {
    const t = line.t;
    const prev = this.lastWrite.get(slot);
    // abs(): startup ingestion can deliver readings out of time order.
    if (prev && (prev.key === key || Math.abs(t - prev.t) < THROTTLE_MS)) return;
    this.lastWrite.set(slot, { t, key });
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(line) + '\n');
  }

  private read(): Line[] {
    if (!existsSync(this.file)) return [];
    const out: Line[] = [];
    for (const raw of readFileSync(this.file, 'utf8').split('\n')) {
      try {
        const l = JSON.parse(raw) as Line;
        if (typeof l?.t === 'number') out.push(l);
      } catch {
        // corrupt or partial line: skip
      }
    }
    return out;
  }

  prune(): void {
    if (!existsSync(this.file)) return;
    const cutoff = this.now() - PRUNE_MS;
    const kept = this.read().filter((l) => l.t >= cutoff);
    writeFileSync(this.file, kept.map((l) => JSON.stringify(l) + '\n').join(''));
  }

  /** Last 7 local calendar days, one entry per agent per day with data, newest day first. */
  days(): HistoryDay[] {
    const start = new Date(this.now());
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (DAYS - 1));
    const byDay = new Map<string, HistoryDay>();
    const sessions = new Map<string, Map<string, { id: string; project: string; peakContextPct: number }>>();

    for (const l of this.read().sort((a, b) => a.t - b.t)) {
      if (l.t < start.getTime()) continue;
      const k = `${dayKey(l.t)}|${l.agent}`;
      let d = byDay.get(k);
      if (!d) byDay.set(k, (d = { day: dayKey(l.t), agent: l.agent, sessions: [] }));
      if (l.kind === 'agent') {
        if (l.fiveHourPct !== undefined) d.peakFiveHourPct = Math.max(d.peakFiveHourPct ?? 0, l.fiveHourPct);
        if (l.weeklyPct !== undefined) d.weeklyEndPct = l.weeklyPct; // lines are time-sorted: last one wins
      } else if (l.contextPct !== undefined) {
        const m = sessions.get(k) ?? new Map();
        sessions.set(k, m);
        const s = m.get(l.id);
        if (!s || l.contextPct > s.peakContextPct) m.set(l.id, { id: l.id, project: l.project, peakContextPct: l.contextPct });
      }
    }
    return [...byDay.entries()]
      .map(([k, d]) => ({ ...d, sessions: [...(sessions.get(k)?.values() ?? [])] }))
      .sort((a, b) => b.day.localeCompare(a.day) || a.agent.localeCompare(b.agent));
  }
}
