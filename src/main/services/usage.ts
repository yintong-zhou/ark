import type { AgentId, AgentStatus, Session, UsageState } from '@shared/types';
import { KEEP_MS, mergeWindow, pickWindows } from '@shared/usage-math';
import type { Adapter, AdapterUpdate } from './adapters/types';
import type { HistoryStore } from './history';

/** Merges every adapter's updates into one UsageState, logs history and notifies listeners. */
export class UsageService {
  private agents = new Map<AgentId, AgentStatus>();
  private sessions = new Map<string, Session>();
  private listeners = new Set<(s: UsageState) => void>();

  constructor(
    private adapters: Adapter[],
    private history: HistoryStore,
    private now: () => number = Date.now,
  ) {
    for (const a of adapters) this.agents.set(a.id, { id: a.id, installed: false });
  }

  private detected?: Promise<void>;

  async start(): Promise<void> {
    this.detected = this.probe();
    await this.detected;
    await this.each((a) => a.start((u) => this.apply(u)));
    this.history.prune();
    await this.pullWindows();
  }

  /** The state once agents are detected, so the UI never flashes "not installed" at launch. */
  async ready(): Promise<UsageState> {
    await this.detected;
    return this.get();
  }

  /** Run fn for every adapter in parallel; one failing adapter must not stop the others. */
  private async each(fn: (a: Adapter) => unknown) {
    const results = await Promise.allSettled(this.adapters.map(async (a) => fn(a)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`${this.adapters[i].id} adapter failed`, r.reason);
    });
  }

  stop(): void {
    for (const a of this.adapters) a.stop();
  }

  /** Re-detect, re-read accounts and pull fresh windows from live sources (Codex app-server). */
  async refresh(): Promise<UsageState> {
    await this.probe();
    await this.pullWindows();
    return this.get();
  }

  private async pullWindows() {
    await this.each(async (a) => {
      const windows = await a.refresh();
      if (windows.length) this.apply({ agent: a.id, windows });
    });
  }

  get(): UsageState {
    return {
      agents: [...this.agents.values()].map((a) => ({ ...a })),
      sessions: [...this.sessions.values()],
    };
  }

  onChanged(cb: (s: UsageState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  apply(u: AdapterUpdate): void {
    const st = this.agents.get(u.agent);
    if (!st) return;
    if (u.account) st.account = u.account;
    if (u.windows?.length) {
      const w = pickWindows(u.windows);
      st.fiveHour = mergeWindow(st.fiveHour, w.fiveHour);
      st.weekly = mergeWindow(st.weekly, w.weekly);
      // When the reading came from a session file, it is as old as that file, not "now".
      const at = u.session?.lastSeen ?? this.now();
      st.updatedAt = Math.max(st.updatedAt ?? 0, at);
      // Expired windows (last week's file) say nothing about today: keep them out of history.
      const nowSec = this.now() / 1000;
      if ([st.fiveHour, st.weekly].some((w) => w && w.resetsAt > nowSec)) this.history.recordAgent(st, at);
    }
    if (u.session) {
      const key = `${u.agent}:${u.session.id}`;
      const cur = this.sessions.get(key);
      if (!cur || u.session.lastSeen >= cur.lastSeen) {
        this.sessions.set(key, u.session);
        this.history.recordSession(u.session, u.session.lastSeen);
      }
    }
    const cutoff = this.now() - KEEP_MS;
    for (const [k, s] of this.sessions) if (s.lastSeen < cutoff) this.sessions.delete(k);
    this.notify();
  }

  private async probe() {
    await this.each(async (a) => {
      const st = this.agents.get(a.id)!;
      Object.assign(st, await a.detect());
      st.account = st.installed ? await a.account() : undefined;
    });
    this.notify();
  }

  private notify() {
    const s = this.get();
    for (const cb of this.listeners) cb(s);
  }
}
