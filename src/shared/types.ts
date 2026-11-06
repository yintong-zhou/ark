import type { AgentDef, EngineId, Tier } from './agent-file';
import type { ImageInput, Upload } from './attachments';
import type { Project, Reaction, Thread, ThreadMessage, ThreadUpdate } from './thread';

// Common model shared by main, preload and renderer.
// Times: resetsAt is epoch SECONDS; lastSeen/updatedAt are epoch MILLISECONDS.

export type AgentId = 'claude' | 'codex' | 'opencode';

/** A usage window, identified by its duration (300 = 5-hour, 10080 = weekly), never by position. */
export type UsageWindow = { usedPct: number; resetsAt: number; minutes: number };

export type Account = {
  loggedIn: boolean;
  method: 'subscription' | 'apiKey' | 'unknown';
  email?: string;
  plan?: string;
};

export type AgentStatus = {
  id: AgentId;
  installed: boolean;
  version?: string;
  path?: string;
  account?: Account;
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
  updatedAt?: number;
};

export type Session = {
  id: string;
  agent: AgentId;
  project: string;
  cwd: string;
  model?: string;
  contextUsed?: number;
  contextSize?: number;
  contextPct?: number;
  tokens?: number;
  costUsd?: number;
  lastSeen: number;
};

export type UsageState = { agents: AgentStatus[]; sessions: Session[] };

export type StatuslineStatus = 'connected' | 'disconnected' | 'bypassed';

export type SkillSource = 'claude-user' | 'claude-plugin' | 'agents-user' | 'codex-user' | 'codex-system';

export type CatalogList = { agents: AgentDef[]; invalid: { file: string; error: string }[] };
export type ImportableAgent = { path: string; name: string; source: string }; // source: 'Claude Code' or the plugin name

export type SkillInfo = { name: string; source: SkillSource; description: string };

export type EngineInfo = { id: EngineId; installed: boolean; path?: string; version?: string; manual: boolean };
export type EnginesConfig = { claude?: { path?: string }; codex?: { path?: string; tiers?: Partial<Record<Tier, string>> } };

export type ChatStarted = { chatId: string; engine: EngineId; model: string; rerouted?: true };

export type ViewMode = 'compact' | 'detailed';

export type HistoryDay = {
  day: string;
  agent: AgentId;
  peakFiveHourPct?: number;
  weeklyEndPct?: number;
  sessions: { id: string; project: string; peakContextPct: number }[];
};

/** The only API the sandboxed renderer can reach (exposed by the preload as window.ark). */
export interface ArkApi {
  usage: {
    get(): Promise<UsageState>;
    refresh(): Promise<UsageState>;
    onChanged(cb: (s: UsageState) => void): () => void;
  };
  history: { get(): Promise<HistoryDay[]> };
  statusline: {
    status(): Promise<StatuslineStatus>;
    connect(): Promise<StatuslineStatus>;
    disconnect(): Promise<StatuslineStatus>;
  };
  settings: { getView(): Promise<ViewMode>; setView(v: ViewMode): Promise<void> };
  catalog: {
    list(): Promise<CatalogList>;
    save(a: AgentDef): Promise<void>;
    remove(id: string): Promise<void>;
    importable(): Promise<ImportableAgent[]>;
    import(path: string): Promise<AgentDef>;
    draft(description: string): Promise<AgentDef>;
  };
  skills: { list(): Promise<SkillInfo[]> };
  engines: { status(): Promise<EngineInfo[]>; save(c: EnginesConfig): Promise<void> };
  chat: {
    pickFolder(): Promise<string | null>;
    start(agentId: string, projectDir: string): Promise<ChatStarted>;
    send(chatId: string, text: string): Promise<void>;
    stop(chatId: string): Promise<void>;
    onEvent(cb: (chatId: string, e: ChatEvent) => void): () => void;
  };
  projects: {
    list(): Promise<Project[]>;
    add(dir: string): Promise<Project>;
    gitInit(id: string): Promise<Project>;
  };
  threads: {
    list(): Promise<Thread[]>;
    open(id: string): Promise<{ thread: Thread; messages: ThreadMessage[] }>;
    create(projectId: string, text: string, files?: Upload[]): Promise<Thread>;
    send(id: string, text: string, files?: Upload[]): Promise<void>;
    /** An image attached to a message of the thread, as base64. */
    attachment(id: string, file: string): Promise<ImageInput>;
    approveTeam(id: string, agentIds: string[]): Promise<void>;
    react(id: string, seq: number, emoji: Reaction): Promise<void>;
    startDeveloper(id: string): Promise<void>;
    /** Allows or denies a pending approval card. */
    answer(id: string, seq: number, allow: boolean): Promise<void>;
    pause(id: string): Promise<void>;
    onUpdate(cb: (u: ThreadUpdate) => void): () => void;
  };
}

export type TokenCount = { input: number; cached: number; output: number };

/**
 * What one finished agent turn returns to its caller. tokens is the turn's total use (for display);
 * contextUsed is how full the context was at the turn's last request (for the handoff), absent when the engine's tokens.input already is that.
 */
export type TurnResult = { text: string; model: string; tokens: TokenCount; contextWindow?: number; contextUsed?: number };

/** What an engine session tells the chat: an answer, the end of a turn, or a failure. */
export type ChatEvent =
  | { type: 'message'; text: string }
  | { type: 'turn'; model: string; tokens: TokenCount; contextWindow?: number; contextUsed?: number }
  | { type: 'approval'; id: string; tool: string; detail: string }
  | { type: 'limits'; engine: EngineId; windows: UsageWindow[] }
  | { type: 'error'; kind: 'isolation' | 'engine' | 'exit'; detail: string };
