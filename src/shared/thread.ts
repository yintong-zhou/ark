import type { Attachment } from './attachments';
import type { EngineId, Tier } from './agent-file';
import type { TokenCount } from './types';
import type { PermissionMode } from './permissions';
import type { EngineAssignment } from './agent-problems';

export const MANAGER = 'head-of-staff';
export const LEGACY_MANAGER = 'project-manager';
export const PLANNING_BUDGET = 20;
/** Consecutive member-to-member handoffs before the floor goes back to the Head of Staff. */
export const MEMBER_RELAYS = 3;
export const HANDOFF_AT = 0.4;
export type Project = { id: string; name: string; dir: string; git: boolean };
export type Phase = 'team' | 'planning' | 'build' | 'done';
export type Level = Tier;
export type ThreadStatus = 'running' | 'waiting' | 'idle' | 'error'; // waiting = for the user
export type Reaction = '👍' | '👎';
export type TeamPick = { agent: string; reason: string };
export type Difficulty = 'easy' | 'hard';
export type ReviewKind = 'code' | 'security';
export type Roles = { planner?: string; builders: string[]; codeReview?: string; securityReview?: string };
export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskInput = { title: string; status: TaskStatus; agent?: string };
export type ThreadTask = TaskInput & { id: string };
export const REVIEW_ROUNDS = 2;
export const BUILD_TURN_MS = 3_600_000; // developer turns, approvals included
export type PhaseStep = 'develop' | 'review' | 'security' | 'blocked' | 'done';
export type BuildPhase = {
  title: string; text: string; step: PhaseStep;
  builder?: string;
  base?: string;      // commit the phase started from (set when it starts)
  commit?: string;    // last commit Ark made for it
  rounds: number;     // times the developer was sent back (checks or reviews)
  notes: number;      // review findings so far, all rounds
  open: number;       // findings in the current review round
  checks?: string[];  // scripts that passed at the last run; [] = no checks found; undefined = not run yet
};
/** One build cycle's plan file and phases. */
export type ReviewContext = { roles: Roles; waived: ReviewKind[] };
export type BuildCycle = { plan: string; phases: BuildPhase[]; reviewContext?: ReviewContext };
/**
 * `removed` is set once the worktree is removed and never cleared. Each approved follow-up plan is a new cycle in the
 * same worktree: `cycle` counts them (absent = 1) and `previous` keeps the earlier ones, oldest first.
 */
export type Build = {
  worktree: string; branch: string; plan: string; phases: BuildPhase[]; current: number; removed?: true; cycle?: number; previous?: BuildCycle[];
  reviewContext?: ReviewContext;
  summaryAt?: number; // last seq the cycle's summary reads; later messages are answered after it, also after a restart
};
export type Control =
  | { kind: 'team'; picks: TeamPick[]; leftOut: string; difficulty?: Difficulty; roles?: Roles }
  | { kind: 'roles'; roles: Partial<Roles> }
  | { kind: 'next'; agent: string; level?: Level }
  | { kind: 'ask'; question: string; choices: string[] }
  | { kind: 'git'; action: 'commit' | 'merge' | 'push' }
  | { kind: 'plan' }
  | { kind: 'review'; pass: boolean; findings: string[] };
type Base = { seq: number; at: number };
export type ThreadMessage = Base & (
  | { kind: 'user'; text: string; attachments?: Attachment[] }
  | { kind: 'agent'; agent: string; text: string; model: string; engine?: EngineId; tokens: TokenCount; control?: Control }
  | { kind: 'reaction'; target: number; emoji: Reaction }
  | { kind: 'note'; text: string } // Ark's own line: shown to the user and to the agents
  | { kind: 'phase'; index: number; cycle?: number } // shown as the phase card; cycle absent = 1
  | { kind: 'approval'; agent: string; tool: string; detail: string }
  | { kind: 'decision'; target: number; allow: boolean } // the answer to an approval, hidden like a reaction
);
export type NewMessage = ThreadMessage extends infer M ? (M extends ThreadMessage ? Omit<M, 'seq' | 'at'> : never) : never;
/** How one usage window moved while the thread ran: the first reading, the highest since, and which window it was. */
export type WindowMove = { from: number; to: number; resetsAt: number };
export type ThreadWindows = Partial<Record<EngineId, { fiveHour?: WindowMove; weekly?: WindowMove }>>;
export type Thread = {
  id: string; projectId: string; title: string; createdAt: number;
  phase: Phase; status: ThreadStatus;
  permissionMode?: PermissionMode;    // absent on legacy threads: ask
  projectCode?: 'allowed' | 'denied'; // the user's answer to running the repository's checks; absent = not asked yet
  assignments?: Record<string, EngineAssignment>; // actual engine/model, including across restarts
  tags?: string[];                   // labels the user wrote as #tag, kept on the thread
  tasks?: ThreadTask[];              // the user's board; assignment never starts an agent
  speaking?: string;                 // agent whose turn is running
  team: string[];                    // approved agent ids, MANAGER first; empty during the team phase
  roles?: Roles;
  difficulty?: Difficulty;
  waived?: ReviewKind[];
  waitingOn?: string;                // agent that asked the user
  agentTurns: number;                // planning agent turns since the last user message
  relay?: number;                    // consecutive member-to-member handoffs (autonomous sessions)
  retried: boolean;                  // the current speaker already got its one correction
  summarizing: boolean;              // the manager was asked for the budget summary
  cursors: Record<string, number>;   // last seq each agent's live session has seen
  handoffs: Record<string, { seq: number; text: string }>;
  build?: Build;
  approvals?: number[];              // seqs of approval messages still waiting
  windows?: ThreadWindows;           // how the account's usage windows moved while the thread ran
};
export type ThreadUpdate = { thread: Thread; added: ThreadMessage[] };
