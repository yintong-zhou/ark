// The conductor: runs a thread's agents one turn at a time through AgentRunner, applies the turn rules,
// persists every change through ThreadStore and tells the listeners. Turns run in a background loop per
// thread, guarded by a generation number: pause, stopAll and every new loop bump it, and a loop that sees
// a different number after an await returns without recording anything.
// The build phase runs its own loop (runBuild) over the build rules; Git and the checks go through Workspace.
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { agentId, type AgentDef, type EngineId, type Permissions } from '@shared/agent-file';
import type { ImageInput, Upload } from '@shared/attachments';
import {
  BUILD_TURN_MS, MANAGER,
  type Build, type Control, type Level, type NewMessage, type Reaction, type ReviewKind, type Thread, type ThreadMessage, type ThreadUpdate,
} from '@shared/thread';
import { taskBoardText, taskInput } from '@shared/tasks';
import { atLevel, chooseThreadEngine } from '@shared/agent-problems';
import { buildProblem, checkProposal, checkRoles, missingReviews, reviewer, rolesLine } from '@shared/roles';
import { autonomous, modeOf, permissionMode, PERMISSION_LABEL, type PermissionMode } from '@shared/permissions';
import { decideApproval } from '../engines/approval-policy';
import { tokensBy, windowLines } from '@shared/thread-view';
import { mergeTags } from '@shared/tokens';
import type { ChatEvent, TurnResult, UsageWindow } from '@shared/types';
import { moveWindows } from '@shared/usage-math';
import type { AgentRunner } from '../agent-runner';
import type { Catalog } from '../catalog';
import { afterBuildUser, afterChecks, afterManager, afterReview, openPoints, startBuild, withPhase, type BuildStep } from './build-rules';
import { formatForAgent, NOTES, parsePhases, parseReply, REQUEST_MAX, withProtocol, type ThreadRole } from './protocol';
import { afterReply, afterUser, approveTeam, mentionOf, needsHandoff, type Step } from './rules';
import type { ThreadStore } from './store';
import { branchName, setupHints, type CheckResult, type Workspace } from './workspace';
import { resolveInside } from '../files/guard';

export type ConductorDeps = {
  store: ThreadStore;
  catalog: Pick<Catalog, 'get' | 'list'>;
  head: () => AgentDef;
  runner: Pick<AgentRunner, 'startAgent' | 'turn' | 'stop' | 'answer' | 'onEvent'>;
  workspace: Workspace;
  handoffThreshold?: (engine: EngineId) => number; // percent used
  worktrees: string; // root folder of the threads' worktrees
  windows: (engine: EngineId) => { fiveHour?: UsageWindow; weekly?: UsageWindow } | undefined; // the account's current usage windows
  checksStopMs?: number; // how long pause and a permission change wait for stopped checks to exit
  /** The thread branch's Git state in plain lines, for the summary; read-only. Ark never commits, merges or pushes for it. */
  gitState?: (t: Thread) => Promise<string[] | undefined>;
};

/** How speak() runs a turn. */
type Speak = {
  /**
   * A build session: the build protocol, in `cwd`. A fresh one gets `lead`, then the transcript after
   * `since` (none when undefined); a live one gets the transcript it has not seen. No handoff.
   */
  build?: { cwd: string; permissions?: Permissions; lead?: string; since?: number };
  role?: ThreadRole;
  note?: string;
  /** A single turn at a chosen level. */
  level?: Level;
  timeoutMs?: number;
  /** An extra check on the parsed reply: an error turns it into a bad block (no control). */
  check?: (control: Control | undefined, body: string) => string | undefined;
  /** The input stops at this seq, and so does the cursor: later messages stay unseen for the next turn. */
  until?: number;
};
type Spoken = { t: Thread; chatId: string; body: string; control?: Control; error?: string };

const TITLE_MAX = 60;
const REVIEW_REQUEST_BUDGET = 40_000;

export class Conductor {
  private readonly listeners = new Set<(u: ThreadUpdate) => void>();
  private readonly generation = new Map<string, number>();
  private readonly interrupts = new Map<string, { to?: string }>(); // a user message sent during a turn
  // ponytail: live sessions stay open until Ark quits; only the speaker's is stopped when the thread pauses or fails (or hands off). Stopping idle threads' sessions is the upgrade if the process count matters.
  private readonly sessions = new Map<string, Map<string, string>>(); // threadId -> agentId -> chatId
  private readonly engines = new Map<string, EngineId>(); // chatId -> the engine that runs it
  private readonly pending = new Map<string, Map<number, { chatId: string; id: string }>>(); // threadId -> approval seq -> engine request
  // threadId -> the pending project code card; in memory only, so after a restart the card shows as expired and is asked again.
  private readonly consent = new Map<string, { seq: number; done: (allow: boolean | undefined) => void; kind?: ReviewKind }>();
  private readonly checks = new Map<string, { ac: AbortController; done: Promise<unknown> }>(); // threadId -> its running checks
  private readonly starting = new Set<string>(); // threads whose startDeveloper is in flight
  private readonly deleting = new Set<string>();

  constructor(private readonly deps: ConductorDeps) {
    deps.runner.onEvent((chatId, e) => {
      if (e.type === 'approval') this.approval(chatId, e);
    });
  }

  onUpdate(cb: (u: ThreadUpdate) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  create(projectId: string, text: string, files: Upload[] = [], mode: PermissionMode = 'auto'): Thread {
    const { store, catalog } = this.deps;
    if (!catalog.list().agents.length) throw new Error(NOTES.noAgents);
    const project = store.projects().find((p) => p.id === projectId);
    if (!project) throw new Error('Unknown project');
    const title = (text.trim().split('\n')[0].trim() || files[0]?.name || 'New thread').slice(0, TITLE_MAX);
    let t = { ...store.create(projectId, title), permissionMode: permissionMode(mode) };
    store.save(t);
    const tags = mergeTags(undefined, text);
    if (tags.length) store.save((t = { ...t, tags }));
    this.emit(t, [store.append(t.id, this.userMessage(t.id, text, files))]);
    this.go(t, { do: 'turn', agent: MANAGER });
    return this.thread(t.id);
  }

  send(threadId: string, text: string, files: Upload[] = []): void {
    let t = this.thread(threadId);
    const m = this.deps.store.append(threadId, this.userMessage(threadId, text, files));
    const tags = mergeTags(t.tags, text);
    if (tags.length !== (t.tags?.length ?? 0)) this.deps.store.save((t = { ...t, tags }));
    // The build is starting, or a build turn or the checks run: the developer reads it on its next turn. During the
    // summary turn the Head of Staff gets it right after the summary (runBuild); after a restart, on the next turn.
    if (this.starting.has(threadId) || (t.phase === 'build' && t.status === 'running')) return this.emit(t, [m]);
    if (t.status === 'running') {
      this.interrupts.set(threadId, { to: mentionOf(text, t.team) });
      this.emit(t, [m]);
      return;
    }
    if (t.phase === 'build') {
      // Old thread, or an assigned builder/reviewer that left the catalog or lost write access: the Head reassigns the roles.
      if (buildProblem(t, (key) => this.deps.catalog.get(key))) {
        this.save(t, [m]);
        void this.runLegacy(t, this.nextGen(t.id));
        return;
      }
      const d = afterBuildUser(t);
      this.save(d.thread, [m]);
      return this.goBuild(d.thread, d.step);
    }
    // Team and planning; after a build, the Head of Staff answers follow-ups (read-only, in the project).
    const d = afterUser(t, mentionOf(text, t.team));
    this.settle(d.thread, d.step, [m]);
  }

  approveTeam(threadId: string, agentIds: string[]): void {
    const t = this.thread(threadId);
    if (t.phase !== 'team' || t.status !== 'waiting') throw new Error('The team can be approved only while the manager waits on its proposal');
    for (const id of agentIds) if (!this.deps.catalog.get(id)) throw new Error(`Unknown agent: ${id}`);
    const names = this.names();
    const proposal = this.deps.store.messages(threadId).findLast((m) => m.kind === 'agent' && m.agent === MANAGER && m.control?.kind === 'team');
    const control = proposal?.kind === 'agent' && proposal.control?.kind === 'team' ? proposal.control : undefined;
    const d = approveTeam(t, agentIds, names, control);
    const note = this.deps.store.append(threadId, { kind: 'note', text: `Team approved: ${d.thread.team.map((id) => names[id] ?? id).join(', ')}.` });
    this.settle(d.thread, d.step, [note]);
  }

  /** Policy changes are effective only after every old session and approval has been invalidated. */
  async setPermissionMode(threadId: string, value: unknown): Promise<void> {
    const mode = permissionMode(value);
    const t = this.thread(threadId);
    if (modeOf(t) === mode) return;
    if (this.starting.has(threadId) && !this.consent.get(threadId)?.kind) throw new Error('Wait for the developer to finish starting before changing permissions');
    this.halt(t);
    for (const agent of [...(this.sessions.get(threadId)?.keys() ?? [])]) this.dropSession(threadId, agent);
    // The mode is saved at once, so a later pause or change sees it. A thread waiting on the user keeps its card (team,
    // plan or ask) and who asked; a running one goes idle, once its checks (if any) have stopped.
    const cur = this.thread(threadId);
    const waiting = cur.status === 'waiting';
    const checks = this.checks.has(threadId);
    const next: Thread = { ...cur, permissionMode: mode, ...(!waiting && !checks && { status: 'idle', speaking: undefined, waitingOn: undefined }) };
    this.deps.store.save(next);
    this.emit(next, [this.deps.store.append(threadId, { kind: 'note', text: `Permissions changed to ${PERMISSION_LABEL[mode]}. Sessions stopped${waiting ? '.' : '; send a message to continue.'}` })]);
    if (checks) await this.idleAfterChecks(next);
  }

  react(threadId: string, seq: number, emoji: Reaction): void {
    const t = this.thread(threadId);
    if (!this.deps.store.messages(threadId).some((m) => m.seq === seq && m.kind === 'agent')) throw new Error('You can react only to an agent message');
    this.emit(t, [this.deps.store.append(threadId, { kind: 'reaction', target: seq, emoji })]);
  }

  saveTask(threadId: string, taskId: string | null, value: unknown): void {
    const t = this.thread(threadId);
    const input = taskInput(value);
    if (input.agent && (!t.team.includes(input.agent) || !this.def(input.agent))) {
      throw new Error('Assign tasks only to agents in this thread\'s team');
    }
    const tasks = t.tasks ?? [];
    if (taskId !== null && !tasks.some((x) => x.id === taskId)) throw new Error('Unknown task');
    if (taskId === null && tasks.length >= 100) throw new Error('A thread can have at most 100 tasks');
    const task = { ...input, id: taskId ?? randomUUID() };
    const next = { ...t, tasks: taskId === null ? [...tasks, task] : tasks.map((x) => x.id === taskId ? task : x) };
    this.deps.store.save(next);
    this.emit(next, []);
  }

  removeTask(threadId: string, taskId: string): void {
    const t = this.thread(threadId);
    if (!t.tasks?.some((x) => x.id === taskId)) throw new Error('Unknown task');
    const next = { ...t, tasks: t.tasks.filter((x) => x.id !== taskId) };
    this.deps.store.save(next);
    this.emit(next, []);
  }

  /**
   * Creates the thread's worktree on a new branch, commits the plan into it and starts the build loop. A plan written
   * after a build is a new cycle in the same worktree and branch, from its HEAD; a removed or missing worktree refuses
   * it and is never recreated. Every refusal leaves the thread as it was (a later cycle's old review waivers aside).
   */
  async startDeveloper(threadId: string): Promise<void> {
    const { store, workspace: ws, worktrees } = this.deps;
    const planOf = (x: Thread) => {
      const m = store.messages(threadId).findLast((y) => y.kind === 'agent');
      if (x.phase !== 'planning' || m?.kind !== 'agent' || m.control?.kind !== 'plan') throw new Error('The developer can start only once the plan is ready');
      return m;
    };
    let t = this.thread(threadId);
    let plan = planOf(t);
    const problem = buildProblem(t, (id) => this.deps.catalog.get(id));
    if (problem) throw new Error(problem);
    const prior = t.build; // the earlier cycle, when this plan follows a finished build
    if (prior?.removed) throw new Error(NOTES.worktreeRemoved);
    if (prior && !existsSync(prior.worktree)) throw new Error(NOTES.worktreeMissing(prior.worktree));
    if (this.starting.has(threadId)) throw new Error('The developer is already starting');
    this.starting.add(threadId);
    const entryGen = this.generation.get(threadId);
    try {
      // A review waiver covers one cycle: the next one asks again.
      if (prior && t.waived?.length) {
        store.save((t = { ...t, waived: undefined }));
        this.emit(t, []);
      }
      for (const kind of missingReviews(t)) {
        const allowed = await this.askWaiver(t, kind);
        if (!allowed || this.generation.get(threadId) !== entryGen) throw new Error(`The build did not start: there is no ${kind} review. Ask the Head of Staff to pick a reviewer, or allow the build without it.`);
        t = this.thread(threadId);
      }
      const currentProblem = buildProblem(t, (id) => this.deps.catalog.get(id));
      if (currentProblem) throw new Error(currentProblem);
      const project = store.projects().find((p) => p.id === t.projectId);
      if (!project) throw new Error('Unknown project');
      const head = await ws.head(project.dir);
      if (this.generation.get(threadId) !== entryGen) return;
      if (!head) throw new Error('The project needs a Git repository with at least one commit');
      // git -C walks up: a folder inside another repository would build that one.
      if (!(await ws.isRepoRoot(project.dir))) throw new Error('The project folder must be the root of its Git repository');
      if (this.generation.get(threadId) !== entryGen) return;
      t = this.thread(threadId); // re-read: the thread may have moved during the await
      plan = planOf(t);
      const laterProblem = buildProblem(t, (id) => this.deps.catalog.get(id));
      if (laterProblem) throw new Error(laterProblem);
      const phases = parsePhases(plan.text);
      if (!phases.length) throw new Error('The plan has no phases');

      this.halt(t); // a turn started by a late user message must not overwrite the build phase
      if (t.status === 'running') this.save((t = { ...t, status: 'idle', speaking: undefined }), []);
      const gen = this.generation.get(threadId);
      const worktree = prior?.worktree ?? join(worktrees, threadId.slice(0, 8));
      const branch = prior?.branch ?? branchName(t.title, threadId);
      // A start that failed after the worktree was made (plan write or commit) resumes in it: Ark never removes worktrees.
      const made = existsSync(worktree) && (await ws.isRepoRoot(worktree)) ? await ws.head(worktree) : undefined;
      if (this.generation.get(threadId) !== gen) return; // Ark closed meanwhile: nothing was created
      if (!made) {
        if (prior) throw new Error(NOTES.worktreeMissing(worktree)); // a later cycle never recreates it
        await ws.addWorktree(project.dir, worktree, branch);
      }
      const currentBranch = await ws.branch(worktree);
      if (this.generation.get(threadId) !== gen) return;
      if (currentBranch !== branch) throw new Error(`The thread worktree is on ${currentBranch ?? 'a detached HEAD'}, not its recorded branch ${branch}. Check out that branch before starting a build.`);
      const cycle = prior ? (prior.cycle ?? 1) + 1 : 1;
      const dir = join(worktree, 'docs', 'plans');
      // sv-SE: local YYYY-MM-DD. Each cycle has its own plan file.
      const planName = `${new Date().toLocaleDateString('sv-SE')}-${agentId(t.title)}${cycle > 1 ? `-${cycle}` : ''}`;
      if (made) {
        // Ark's commits take everything in the worktree: work it does not own (the user's edits) must not ride along.
        const stray = await ws.changes(worktree);
        if (this.generation.get(threadId) !== gen) return;
        if (stray.length) throw new Error(NOTES.worktreeDirty(stray));
      }
      // These path checks cannot prevent a concurrent junction swap before the write on Windows.
      if (lstatSync(worktree).isSymbolicLink()) throw new Error('The worktree is a link or junction.');
      for (const part of ['docs', 'docs/plans']) {
        const folder = join(worktree, part);
        try { if (lstatSync(folder).isSymbolicLink()) throw new Error(`Plan directory is a link or junction: ${part}`); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        resolveInside(worktree, part);
        try { mkdirSync(folder); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
        if (lstatSync(folder).isSymbolicLink()) throw new Error(`Plan directory is a link or junction: ${part}`);
        resolveInside(worktree, part);
      }
      let planFile = '';
      for (let suffix = 0; suffix < 10_000; suffix++) {
        const candidate = join(dir, `${planName}${suffix ? `-${suffix}` : ''}.md`);
        try {
          writeFileSync(candidate, plan.text, { flag: 'wx' });
          planFile = candidate;
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
      }
      if (!planFile) throw new Error('Could not find an unused plan filename.');
      await ws.commitPlan(worktree, relative(worktree, planFile), `docs: plan for ${t.title}`); // the phase-1 base

      t = this.thread(threadId);
      const note = store.append(threadId, {
        kind: 'note',
        text: (prior ? `Continuing on branch ${branch} in its worktree, from ${made!.slice(0, 7)}.`
          : `Building on branch ${branch} from ${head.slice(0, 7)}. Uncommitted changes in the project are not included.`) +
          (t.waived?.includes('code') && !reviewer(t, 'code') ? ' No code review in this build.' : '') +
          (t.waived?.includes('security') && !reviewer(t, 'security') ? ' No security review in this build.' : ''),
      });
      const cursors = { ...t.cursors, ...Object.fromEntries(t.roles!.builders.map((id) => [id, plan.seq])) };
      const previous = prior && [...(prior.previous ?? []), { plan: prior.plan, phases: prior.phases, ...(prior.reviewContext && { reviewContext: prior.reviewContext }) }];
      const reviewContext = { roles: t.roles!, waived: [...(t.waived ?? [])] };
      const d = startBuild({ ...t, waitingOn: undefined, cursors }, { worktree, branch, plan: planFile, phases, reviewContext, ...(previous && { cycle, previous }) });
      // Ark closed during the start: the worktree exists, so the build is recorded, but no loop starts.
      if (this.generation.get(threadId) !== gen) return this.save({ ...d.thread, status: 'idle', speaking: undefined }, [note]);
      this.save(d.thread, [note]);
      this.goBuild(d.thread, d.step);
    } finally {
      this.starting.delete(threadId);
    }
  }

  /** Answers a pending approval card. */
  answer(threadId: string, seq: number, allow: boolean): void {
    const t = this.thread(threadId);
    const drop = (a: number[]) => a.filter((s) => s !== seq);
    const consent = this.consent.get(threadId);
    if (consent?.seq === seq && t.approvals?.includes(seq)) {
      this.consent.delete(threadId);
      try {
        this.deps.store.save(consent.kind ? { ...t, ...(allow && { waived: [...new Set([...(t.waived ?? []), consent.kind])] }) } : { ...t, projectCode: allow ? 'allowed' : 'denied' });
        this.setApprovals(threadId, drop, [this.deps.store.append(threadId, { kind: 'decision', target: seq, allow })]);
      } finally {
        consent.done(allow); // the build goes on (or stops on a stale loop) even if the card could not be dropped
      }
      return;
    }
    const req = this.pending.get(threadId)?.get(seq);
    if (!req || !t.approvals?.includes(seq)) throw new Error('This request is no longer pending');
    this.pending.get(threadId)!.delete(seq);
    try {
      this.deps.runner.answer(req.chatId, req.id, allow);
    } catch {
      this.setApprovals(threadId, drop, []); // the session or its request is gone
      throw new Error('This request is no longer pending');
    }
    this.setApprovals(threadId, drop, [this.deps.store.append(threadId, { kind: 'decision', target: seq, allow })]);
  }

  /**
   * Stops the running turn; nothing it would have said is recorded. Does nothing when no turn runs. During the checks the
   * thread stays 'running' (its worktree busy for the Git UI) until they have stopped.
   */
  async pause(threadId: string): Promise<void> {
    const t = this.thread(threadId);
    if (t.status !== 'running' && !this.starting.has(threadId)) return;
    this.halt(t);
    if (this.checks.has(threadId)) return this.idleAfterChecks(t);
    this.save({ ...t, status: 'idle', speaking: undefined }, []);
  }

  async removeProject(projectId: string): Promise<void> {
    const threads = this.deps.store.threads().filter((t) => t.projectId === projectId);
    if (threads.some((t) => this.starting.has(t.id))) {
      throw new Error('Wait for the project\'s thread to finish starting before removing it');
    }
    await Promise.all(threads.filter((t) => t.status === 'running').map((t) => this.pause(t.id)));
    this.deps.store.removeProject(projectId);
  }

  async remove(threadId: string, trash: (path: string) => Promise<void>): Promise<void> {
    const t = this.thread(threadId);
    if (t.status === 'running' || this.starting.has(threadId)) throw new Error('Pause the thread before deleting it');
    if (t.build && !t.build.removed) throw new Error('Remove the thread worktree before deleting it');
    this.halt(t);
    this.deleting.add(threadId);
    try {
      for (const agent of [...(this.sessions.get(threadId)?.keys() ?? [])]) this.dropSession(threadId, agent);
      this.sessions.delete(threadId);
      await this.deps.store.removeThread(threadId, trash);
    } finally {
      this.deleting.delete(threadId);
    }
  }

  /** The thread's worktree was removed: its folder is never offered again. Does nothing when the thread has no build. */
  worktreeRemoved(threadId: string): void {
    const t = this.thread(threadId);
    if (t.build) this.save({ ...t, build: { ...t.build, removed: true } }, []);
  }

  stopAll(): void {
    for (const [id, n] of this.generation) this.generation.set(id, n + 1);
    for (const c of this.checks.values()) c.ac.abort(); // quitting: no wait
    this.interrupts.clear();
    for (const id of new Set([...this.pending.keys(), ...this.consent.keys()])) this.dropApprovals(id);
    for (const chats of this.sessions.values()) for (const chatId of chats.values()) this.stopChat(chatId);
    this.sessions.clear();
    for (const t of this.deps.store.threads()) {
      if (t.status === 'running') this.save({ ...t, status: 'idle', speaking: undefined }, []);
    }
  }

  /** The user's message, with its files kept in the thread's folder. */
  private userMessage(threadId: string, text: string, files: Upload[]): NewMessage {
    const attachments = files.map((f) => this.deps.store.saveFile(threadId, f));
    return { kind: 'user', text, ...(attachments.length ? { attachments } : {}) };
  }

  private thread(id: string): Thread {
    if (this.deleting.has(id)) throw new Error('Thread is being deleted');
    const t = this.deps.store.get(id);
    if (!t) throw new Error('Unknown thread');
    return t;
  }

  private names(): Record<string, string> {
    return Object.fromEntries([this.deps.head(), ...this.deps.catalog.list().agents].map((a) => [a.id, a.name]));
  }

  private def(id: string): AgentDef | undefined {
    return id === MANAGER ? this.deps.head() : this.deps.catalog.get(id);
  }

  private emit(thread: Thread, added: ThreadMessage[]): void {
    for (const cb of this.listeners) {
      try {
        cb({ thread, added });
      } catch {
        // a broken listener must not break the thread
      }
    }
  }

  private save(t: Thread, added: ThreadMessage[]): void {
    // A turn works on its own copy; user edits and pending approvals live only on disk.
    const disk = this.deps.store.get(t.id);
    const next: Thread = { ...t, ...(disk?.tags && { tags: disk.tags }), permissionMode: disk?.permissionMode, projectCode: disk?.projectCode, waived: disk?.waived, tasks: disk?.tasks, approvals: disk?.approvals };
    this.deps.store.save(next);
    this.emit(next, added);
  }

  /** Changes the thread's pending approvals on disk, the only place they are kept. */
  private setApprovals(threadId: string, edit: (a: number[]) => number[], added: ThreadMessage[]): void {
    const t = this.thread(threadId);
    const next = { ...t, approvals: edit(t.approvals ?? []) };
    this.deps.store.save(next);
    this.emit(next, added);
  }

  /** A runner approval request: a card on the thread that owns the chat. Unknown chats are ignored. */
  private approval(chatId: string, e: Extract<ChatEvent, { type: 'approval' }>): void {
    try {
      for (const [threadId, chats] of this.sessions) {
        for (const [agent, c] of chats) {
          if (c !== chatId) continue;
          const t = this.thread(threadId);
          const mode = modeOf(t);
          const decision = agent === t.build?.phases[t.build.current]?.builder && t.build && mode !== 'ask'
            ? mode === 'full' ? { allow: true, reason: 'Full access selected by the user' } : decideApproval(e.request, t.build.worktree, this.projectCode(threadId))
            : { allow: false, reason: '' };
          if (decision.allow) {
            this.deps.runner.answer(chatId, e.id, true); // throws when the session ended: no "Allowed" note then
            const note = this.deps.store.append(threadId, { kind: 'note', text: `Allowed ${e.tool}: ${e.detail}. ${decision.reason}.` });
            this.emit(t, [note]);
            return;
          }
          const m = this.deps.store.append(threadId, { kind: 'approval', agent, tool: e.tool, detail: e.detail });
          let mine = this.pending.get(threadId);
          if (!mine) this.pending.set(threadId, (mine = new Map()));
          mine.set(m.seq, { chatId, id: e.id });
          this.setApprovals(threadId, (a) => [...a, m.seq], [m]);
          return;
        }
      }
    } catch {
      // the card could not be recorded: deny rather than leave the engine waiting; never throw into the runner's dispatch
      try {
        this.deps.runner.answer(chatId, e.id, false);
      } catch {
        // the session is already gone
      }
    }
  }

  /**
   * Forgets the thread's pending approvals (only that chat's, when given); their cards show as expired. Without a chat
   * the project code card goes too, answered `undefined`: it belongs to the thread, not to a turn.
   */
  private dropApprovals(threadId: string, chatId?: string): void {
    const mine = this.pending.get(threadId);
    const gone = [...(mine ?? [])].filter(([, r]) => !chatId || r.chatId === chatId).map(([seq]) => seq);
    for (const s of gone) mine!.delete(s);
    const consent = chatId ? undefined : this.consent.get(threadId);
    if (consent) {
      this.consent.delete(threadId);
      gone.push(consent.seq);
    }
    if (!gone.length) return;
    try {
      this.setApprovals(threadId, (a) => a.filter((s) => !gone.includes(s)), []);
    } finally {
      consent?.done(undefined);
    }
  }

  /** True when the thread may run the repository's code unsandboxed: Full access, or the user allowed it. */
  private projectCode(threadId: string): boolean {
    const t = this.deps.store.get(threadId);
    return !!t && (modeOf(t) === 'full' || t.projectCode === 'allowed');
  }

  /** Shows the project code card; resolves with the answer, or undefined when the card is dropped (pause, quit...). */
  private askProjectCode(t: Thread, commands: string[]): Promise<boolean | undefined> {
    return new Promise((done) => {
      const m = this.deps.store.append(t.id, { kind: 'approval', agent: t.build?.phases[t.build.current]?.builder ?? MANAGER, tool: NOTES.consentTool, detail: NOTES.consent(commands) });
      this.setApprovals(t.id, (a) => [...a, m.seq], [m]);
      this.consent.set(t.id, { seq: m.seq, done });
    });
  }

  private askWaiver(t: Thread, kind: ReviewKind): Promise<boolean | undefined> {
    return new Promise((done) => {
      const m = this.deps.store.append(t.id, { kind: 'approval', agent: MANAGER, tool: NOTES.waiveTool(kind), detail: NOTES.waive(kind) });
      this.setApprovals(t.id, (a) => [...a, m.seq], [m]);
      this.consent.set(t.id, { seq: m.seq, done, kind });
    });
  }

  private stopChat(chatId: string): void {
    this.engines.delete(chatId);
    try {
      this.deps.runner.stop(chatId);
    } catch {
      // the session is already gone
    }
  }

  /** Stops and forgets the agent's live session in the thread, if it has one. */
  private dropSession(threadId: string, agent: string): void {
    const chats = this.sessions.get(threadId);
    const chatId = chats?.get(agent);
    if (!chatId) return;
    chats!.delete(agent);
    this.stopChat(chatId);
  }

  /** Stops the thread's loop and the speaking agent's session, and drops its pending approvals. */
  private halt(t: Thread): void {
    this.generation.set(t.id, (this.generation.get(t.id) ?? 0) + 1);
    this.checks.get(t.id)?.ac.abort();
    this.interrupts.delete(t.id);
    this.dropApprovals(t.id);
    if (t.speaking) this.dropSession(t.id, t.speaking);
  }

  /**
   * After halt(): waits, at most checksStopMs, for the checks it aborted to exit, then saves `t` idle. A hostile repo can
   * start processes that escape the tree kill, so past the bound the thread goes idle anyway with a note. Saves nothing
   * when another halt happened meanwhile: that caller saves the thread instead.
   */
  private async idleAfterChecks(t: Thread): Promise<void> {
    const threadId = t.id;
    const c = this.checks.get(threadId);
    const gen = this.generation.get(threadId);
    if (!c) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = await Promise.race([
      c.done.then(() => false, () => false),
      new Promise<boolean>((r) => { timer = setTimeout(r, this.deps.checksStopMs ?? 10_000, true); }),
    ]);
    clearTimeout(timer);
    if (this.checks.get(threadId) === c) this.checks.delete(threadId); // past the bound, a later pause does not wait on it again
    if (this.generation.get(threadId) !== gen) return;
    const added: ThreadMessage[] = [];
    try {
      if (late) added.push(this.deps.store.append(threadId, { kind: 'note', text: 'Processes started by the checks may still be running.' }));
    } finally {
      this.save({ ...t, status: 'idle', speaking: undefined }, added); // never left 'running' with no loop
    }
  }

  /** Applies a step: a turn starts the loop; wait and idle are saved with the messages added. */
  private settle(t: Thread, step: Step, added: ThreadMessage[], asker?: string): void {
    if (step.do === 'turn') {
      this.save(t, added);
      this.go(t, step);
      return;
    }
    if (step.do === 'idle') return this.save({ ...t, status: 'idle', speaking: undefined }, added);
    const note = step.note ? [this.deps.store.append(t.id, { kind: 'note', text: step.note })] : [];
    this.save({ ...t, status: 'waiting', speaking: undefined, waitingOn: asker }, [...added, ...note]);
  }

  /** Starts a new loop for the thread. Its first save (status running) happens before this returns. */
  private go(t: Thread, step: Step & { do: 'turn' }): void {
    void this.run(t, step, this.nextGen(t.id)).catch(() => {
      // run() turns failures into notes; this only guards against the store failing while it does
    });
  }

  /** Starts a new build loop for the thread; like go(), a running step is saved before this returns. */
  private goBuild(t: Thread, step: BuildStep): void {
    void this.runBuild(t, step, this.nextGen(t.id)).catch(() => {
      // runBuild() turns failures into notes; this only guards against the store failing while it does
    });
  }

  private nextGen(id: string): number {
    const gen = (this.generation.get(id) ?? 0) + 1;
    this.generation.set(id, gen);
    this.interrupts.delete(id);
    return gen;
  }

  /** The seq of the phase card of plan phase `index` in the build's current cycle (0 when there is none). */
  private phaseSeq(threadId: string, b: Build, index: number): number {
    const cycle = b.cycle ?? 1;
    return this.deps.store.messages(threadId).findLast((m) => m.kind === 'phase' && m.index === index && (m.cycle ?? 1) === cycle)?.seq ?? 0;
  }

  /** The first user message the developer has not read yet, if any. */
  private unreadByDeveloper(t: Thread): number | undefined {
    const from = t.cursors[t.build?.phases[t.build.current]?.builder ?? ''] ?? 0;
    return this.deps.store.messages(t.id).find((m) => m.kind === 'user' && m.seq > from)?.seq;
  }

  /**
   * One turn of `agent`: starts its session when it has none, sends the input, records the reply and moves its
   * cursor. Undefined when the loop went stale meanwhile (nothing recorded). The caller saves `running` first.
   */
  private async speak(t: Thread, agent: string, gen: number, o: Speak = {}): Promise<Spoken | undefined> {
    const { store, catalog, runner } = this.deps;
    const id = t.id;
    const live = () => this.generation.get(id) === gen;
    const names = this.names();
    let chats = this.sessions.get(id);
    if (!chats) this.sessions.set(id, (chats = new Map()));

    // The session.
    const project = store.projects().find((p) => p.id === t.projectId);
    let chatId = chats.get(agent);
    const fresh = !chatId;
    if (!chatId) {
      const def = this.def(agent);
      if (!def) throw new Error('Unknown agent');
      const dir = o.build?.cwd ?? project?.dir;
      if (!dir) throw new Error('Unknown project');
      const mode = modeOf(t);
      const job = o.role === 'builder' ? 'builder' : o.role === 'reviewer' ? 'reviewer' : 'other';
      const preferred = chooseThreadEngine(agent, job, t.assignments ?? {}, { claude: this.deps.windows('claude'), codex: this.deps.windows('codex') }, mode, Date.now() / 1000);
      const started = await runner.startAgent(withProtocol(atLevel(def, o.level), o.role ?? (agent === MANAGER ? 'head' : 'member'), mode), dir, o.build?.permissions, mode, preferred, this.projectCode(id));
      chatId = started.chatId;
      if (!live()) {
        this.stopChat(chatId); // paused while starting: the session was never registered
        return undefined;
      }
      chats.set(agent, chatId);
      this.engines.set(chatId, started.engine);
      const previous = t.assignments?.[agent];
      t = { ...t, assignments: { ...t.assignments, [agent]: { engine: started.engine, model: started.model } } };
      const changed = !previous || previous.engine !== started.engine || previous.model !== started.model;
      const sessionNotes = changed ? [store.append(id, { kind: 'note', text: `${names[agent] ?? agent} runs on ${started.engine === 'codex' ? 'Codex' : 'Claude Code'} (${started.model}).` })] : [];
      for (const warning of started.skillWarnings ?? []) sessionNotes.push(store.append(id, { kind: 'note', text: `${names[agent] ?? agent}: ${warning}` }));
      this.save(t, sessionNotes);
    }

    // The input.
    // The cursor moves to the last message in this input, not to the reply: anything added during the
    // turn (a user message, a reaction) is still unseen next time; formatForAgent skips the agent's own.
    const all = o.until === undefined ? store.messages(id) : store.messages(id).filter((m) => m.seq <= o.until!);
    const upTo = all.at(-1)?.seq ?? 0;
    const handoff = o.build ? undefined : t.handoffs[agent];
    const seen = !fresh ? (t.cursors[agent] ?? 0) : o.build ? o.build.since : (handoff?.seq ?? 0);
    const parts: string[] = [];
    if (fresh && o.build?.lead) parts.push('[Ark] ' + o.build.lead);
    if (fresh && handoff) parts.push('[Ark] ' + NOTES.fresh(handoff.text));
    if (fresh && !o.build && t.team.length) parts.push('[Ark] ' + NOTES.roster(t.team.map((a) => ({ id: a, name: names[a] ?? a }))));
    const unseen = seen === undefined ? [] : all.filter((m) => m.seq > seen);
    const readFile = (file: string) => {
      try {
        return store.readFile(id, file);
      } catch {
        return undefined; // a file deleted by hand: the agent is told it could not be read
      }
    };
    parts.push(formatForAgent(unseen, all, names, agent, (a) => readFile(a.file)?.toString('utf8')));
    const images: ImageInput[] = unseen.flatMap((m) =>
      m.kind === 'user'
        ? (m.attachments ?? []).flatMap((a) => {
            const bytes = a.kind === 'image' ? readFile(a.file) : undefined;
            return bytes ? [{ mime: a.mime, data: bytes.toString('base64') }] : [];
          })
        : [],
    );
    if (fresh && project && t.phase === 'team' && agent === MANAGER) parts.push('[Ark] ' + NOTES.teamStart(project.name, project.dir));
    if (t.phase === 'team' && agent === MANAGER) parts.push('[Ark] ' + NOTES.catalog(catalog.list().agents));
    const tasks = store.get(id)?.tasks;
    if (tasks) parts.push(taskBoardText(tasks, names));
    if (o.note) parts.push('[Ark] ' + o.note);
    let result: TurnResult;
    const engine = this.engines.get(chatId);
    const moved = () => engine && (t = { ...t, windows: moveWindows(t.windows, engine, this.deps.windows(engine), Date.now() / 1000) });
    moved();
    try {
      result = await runner.turn(chatId, parts.filter(Boolean).join('\n\n'), o.timeoutMs, undefined, images);
    } finally {
      this.dropApprovals(id, chatId); // an approval still open when its turn ends can no longer be answered
    }
    if (!live()) return undefined;
    moved();

    // The reply.
    const parsed = parseReply(result.text);
    const bad = o.check?.(parsed.control, parsed.body);
    const { body, control, error } = bad ? { body: parsed.body, control: undefined, error: bad } : parsed;
    const msg = store.append(id, { kind: 'agent', agent, text: body, model: result.model, engine, tokens: result.tokens, ...(control ? { control } : {}) });
    if (control?.kind === 'plan' && t.phase !== 'build') store.writePlan(id, body);
    t = { ...t, cursors: { ...t.cursors, [agent]: upTo, ...(o.role === 'builder' ? Object.fromEntries((t.roles?.builders ?? []).map((id) => [id, upTo])) : {}) } };
    this.save(t, [msg]);

    // The handoff (live sessions only; build sessions are short).
    // A failed handoff loses only the handoff: the session is dropped (the next turn replays the
    // transcript from the last handoff) and the reply's own step still runs.
    if (!o.build && needsHandoff(result.contextUsed ?? result.tokens.input, result.contextWindow, engine ? (this.deps.handoffThreshold?.(engine) ?? 40) / 100 : undefined)) {
      let h: TurnResult | Error;
      try {
        h = await runner.turn(chatId, '[Ark] ' + NOTES.handoff);
      } catch (e) {
        h = e instanceof Error ? e : new Error(String(e));
      }
      this.dropApprovals(id, chatId);
      if (!live()) return undefined;
      this.dropSession(id, agent);
      if (h instanceof Error) {
        const note = store.append(id, { kind: 'note', text: `${names[agent] ?? agent} could not write a handoff: ${h.message}` });
        this.save(t, [note]);
      } else {
        t = { ...t, handoffs: { ...t.handoffs, [agent]: { seq: upTo, text: h.text } } };
        this.save(t, []);
      }
    }
    return { t, chatId, body, control, error };
  }

  /** One agent turn, then the next step. Every await is followed by a generation check. */
  private async run(t: Thread, step: Step & { do: 'turn' }, gen: number): Promise<void> {
    const { store, catalog } = this.deps;
    const id = t.id;
    const live = () => this.generation.get(id) === gen;
    const agent = step.agent;
    t = { ...t, status: 'running', speaking: agent, waitingOn: undefined };
    this.save(t, []);
    try {
      // A changed level uses a fresh session for this turn only.
      const def = this.def(agent);
      const bump = !!def && atLevel(def, step.level) !== def;
      if (bump) this.dropSession(id, agent);
      const r = await this.speak(t, agent, gen, {
        note: step.note,
        level: step.level,
        check: (control, body) => {
          if (control?.kind === 'git' && (agent !== MANAGER || t.phase !== 'done' || !t.build || t.build.removed)) return 'ark block: git is available only to the Head after a finished build';
          if (agent === MANAGER && control?.kind === 'team') return checkProposal(control, (id) => catalog.get(id));
          if (agent === MANAGER && control?.kind === 'roles') return checkRoles(control.roles, t.roles, t.team, (id) => catalog.get(id));
          // A plan the build cannot split into phases: the same.
          if (control?.kind === 'plan' && !parsePhases(body).length) return 'ark block: plan has no "## Phase N: <title>" headings';
          return undefined;
        },
      });
      if (!r) return;
      if (bump) this.dropSession(id, agent);
      t = r.t;
      const { control, error } = r;

      // The next step. A user message sent during the turn already came after the agent started,
      // so a wait gives way to it as if it had been sent now.
      const interrupt = this.interrupts.get(id);
      this.interrupts.delete(id);
      if (autonomous(t) && !error && !interrupt && t.phase === 'team' && agent === MANAGER && control?.kind === 'team') {
        const d = approveTeam(t, control.picks.map((p) => p.agent), this.names(), control);
        if (d.step.do === 'turn' && d.step.agent === MANAGER) d.step.note = 'The session policy authorizes this team. Lead the planning and resolve routine decisions within the team.';
        this.settle(d.thread, d.step, [store.append(id, { kind: 'note', text: 'Team selected automatically under the session permission policy.' })]);
        return;
      }
      let d = afterReply(t, agent, control, error, interrupt);
      if (d.step.do === 'wait' && interrupt) d = afterUser(d.thread, interrupt.to);
      const added = agent === MANAGER && control?.kind === 'roles' && !error && d.thread.roles ? [store.append(id, { kind: 'note', text: `Roles updated: ${rolesLine(d.thread.roles, this.names())}` })] : [];
      this.settle(d.thread, d.step, added, d.step.do === 'wait' && control?.kind === 'ask' ? agent : undefined);
      // A plan after a build (phase done) is the next cycle's: it starts the same way.
      if (autonomous(t) && !error && !interrupt && (t.phase === 'planning' || t.phase === 'done') && control?.kind === 'plan' && d.step.do === 'wait') {
        try {
          await this.startDeveloper(id);
        } catch (e) {
          const current = this.thread(id);
          if (modeOf(current) !== modeOf(t)) return;
          this.save({ ...current, status: 'waiting', speaking: undefined }, [store.append(id, { kind: 'note', text: `The automatic build could not start: ${e instanceof Error ? e.message : String(e)}` })]);
        }
      }
    } catch (e) {
      if (!live()) return; // 'stopped' after a pause, or anything once the thread moved on
      this.dropSession(id, agent);
      const note = store.append(id, { kind: 'note', text: `${this.names()[agent] ?? agent} stopped: ${e instanceof Error ? e.message : String(e)}` });
      this.save({ ...t, status: 'error', speaking: undefined }, [note]);
    }
  }

  private async runLegacy(initial: Thread, gen: number): Promise<void> {
    const { store, catalog } = this.deps;
    const id = initial.id;
    const live = () => this.generation.get(id) === gen;
    let t = initial;
    let correction: string | undefined;
    try {
      for (;;) {
        t = { ...t, status: 'running', speaking: MANAGER, waitingOn: undefined };
        this.save(t, []);
        const agents = catalog.list().agents;
        const r = await this.speak(t, MANAGER, gen, {
          note: [NOTES.assignRoles, NOTES.catalog(agents), correction].filter(Boolean).join('\n\n'),
          check: (control) => {
            if (control?.kind === 'ask') return undefined;
            if (control?.kind !== 'roles') return 'ark block: name the build roles or ask the user';
            const error = checkRoles(control.roles, t.roles, agents.map((a) => a.id), (key) => catalog.get(key));
            if (error) return error;
            return buildProblem({ roles: { builders: [], ...t.roles, ...control.roles } }, (key) => catalog.get(key));
          },
        });
        if (!r || !live()) return;
        t = r.t;
        if (r.error || (r.control?.kind !== 'roles' && r.control?.kind !== 'ask')) {
          if (t.retried) return this.save({ ...t, retried: false, status: 'waiting', speaking: undefined, waitingOn: MANAGER }, [store.append(id, { kind: 'note', text: `${MANAGER} did not give Ark a valid instruction. Reply to continue.` })]);
          correction = NOTES.invalid(r.error ?? 'missing or not allowed here');
          t = { ...t, retried: true };
          continue;
        }
        if (r.control.kind === 'ask') return this.save({ ...t, retried: false, status: 'waiting', speaking: undefined, waitingOn: MANAGER }, []);
        const roles = { builders: [], ...t.roles, ...r.control.roles };
        let candidate = { ...t, roles };
        for (const kind of missingReviews(candidate)) {
          const allowed = await this.askWaiver(candidate, kind);
          if (!live()) return;
          if (!allowed) return this.save({ ...t, status: 'waiting', speaking: undefined, waitingOn: MANAGER }, [store.append(id, { kind: 'note', text: `The build did not start: there is no ${kind} review. Ask the Head of Staff to pick a reviewer, or allow the build without it.` })]);
          candidate = { ...candidate, waived: this.thread(id).waived };
        }
        const problem = buildProblem(candidate, (key) => catalog.get(key));
        if (problem) return this.save({ ...t, status: 'waiting', speaking: undefined, waitingOn: MANAGER }, [store.append(id, { kind: 'note', text: problem })]);
        const members = [roles.planner, ...roles.builders, roles.codeReview, roles.securityReview].filter((key): key is string => !!key);
        const build = candidate.build!;
        t = { ...candidate, retried: false, team: [...new Set([...candidate.team, ...members])], build: { ...build, phases: build.phases.map((phase) => phase.step === 'done' ? phase : { ...phase, builder: roles.builders[0] }) } };
        this.save(t, [store.append(id, { kind: 'note', text: `Roles updated: ${rolesLine(roles, this.names())}` })]);
        const d = afterBuildUser(t);
        this.goBuild(d.thread, d.step);
        return;
      }
    } catch (e) {
      if (!live()) return;
      this.save({ ...t, status: 'error', speaking: undefined }, [store.append(id, { kind: 'note', text: `Head of Staff stopped: ${e instanceof Error ? e.message : String(e)}` })]);
    }
  }

  /**
   * The build loop: developer turn, Ark's commit and checks, code review, security review, phase after phase,
   * then the manager's summary. Steps come from the build rules; every await is followed by a generation check.
   */
  private async runBuild(t: Thread, step: BuildStep, gen: number): Promise<void> {
    const { store, workspace: ws } = this.deps;
    const id = t.id;
    const live = () => this.generation.get(id) === gen;
    const names = this.names();
    const turn = (agent: string | undefined, added: ThreadMessage[] = []) =>
      this.save((t = { ...t, status: 'running', speaking: agent, waitingOn: undefined }), added);
    let blockedOn: string[] | undefined; // the failed checks, when the phase blocked on them
    // Project code consent, once per thread: outside Full access, the first time the worktree has checks to run.
    const askConsent = async (dir: string, checks: string[]) => {
      const disk = store.get(id);
      if (!checks.length || !disk || modeOf(disk) === 'full' || disk.projectCode) return;
      await this.askProjectCode(t, ws.checkCommands(dir));
    };
    let asker: string | undefined;
    if (step.do !== 'wait' && step.do !== 'finish') turn(undefined);
    try {
      for (;;) {
        if (step.do === 'finish') {
          // A message the user sent during the summary turn: the Head of Staff answers it now, once.
          const from = t.cursors[MANAGER] ?? 0;
          const unread = store.messages(id).find((m) => m.kind === 'user' && m.seq > from);
          if (unread?.kind === 'user') {
            const d = afterUser(t, mentionOf(unread.text, t.team));
            return this.settle(d.thread, d.step, []);
          }
        }
        if (step.do === 'wait' || step.do === 'finish') {
          const note = step.do === 'wait' && step.note ? [store.append(id, { kind: 'note', text: step.note })] : [];
          const waiting = step.do === 'wait';
          return this.save({ ...t, status: waiting ? 'waiting' : 'idle', speaking: undefined, waitingOn: waiting ? asker : undefined }, note);
        }
        const b = t.build!;
        const p = b.phases[b.current];

        if (step.do === 'review') {
          const agent = reviewer(t, step.who);
          if (!agent) throw new Error(`No ${step.who} reviewer is assigned`);
          const diff = await ws.diff(b.worktree, p.base!);
          if (!live()) return;
          turn(agent);
          this.dropSession(id, agent); // a fresh session per review
          // It reads no transcript: the user's requests (the first and the latest) and the builder's last report go in the lead.
          const all = store.messages(id);
          const asked = all.flatMap((m) => (m.kind === 'user' && m.text.trim() ? [m.text.trim()] : []));
          let size = 0;
          let requestsIncomplete = false;
          const requests: string[] = [];
          for (const request of asked) {
            const text = request.slice(0, REQUEST_MAX);
            if (text.length !== request.length) requestsIncomplete = true;
            if (size + text.length + 3 > REVIEW_REQUEST_BUDGET) { requestsIncomplete = true; continue; }
            requests.push(text); size += text.length + 3;
          }
          const since = this.phaseSeq(id, b, b.current);
          const report = all.findLast((m) => m.kind === 'agent' && m.agent === p.builder && m.seq > since);
          const r = await this.speak(t, agent, gen, {
            build: { cwd: b.worktree, lead: NOTES.review({ kind: step.who, phase: p.text, diff, worktree: b.worktree, requests, requestsIncomplete, ...(report?.kind === 'agent' && report.text && { outcome: report.text }) }) },
            note: step.retry,
            // A consequential review (a hard request) runs one level up; atLevel keeps a locked model as it is.
            role: 'reviewer', level: t.difficulty === 'hard' ? 'heavy' : 'standard',
          });
          if (!r) return;
          this.dropSession(id, agent);
          t = r.t;
          turn(undefined); // the next diff or head is Ark's own work: a git failure is not the reviewer's
          ({ thread: t, step } = afterReview(t, step.who, r.control, r.error, this.unreadByDeveloper(t) !== undefined));
          if ((step.do === 'develop' || step.do === 'summary') && p.builder) this.dropSession(id, p.builder);
          continue;
        }

        if (step.do === 'escalate' || step.do === 'summary') {
          if (step.do === 'summary' && b.summaryAt === undefined) {
            t = { ...t, build: { ...b, summaryAt: store.messages(id).at(-1)?.seq ?? 0 } };
            this.save(t, []);
          }
          const note = step.do === 'escalate'
            ? NOTES.blocked({ phase: p.title, points: blockedOn ?? openPoints(store.messages(id), this.phaseSeq(id, b, b.current)) })
            : NOTES.summary({
                branch: b.branch,
                phases: b.phases.map((q) => ({ title: q.title, notes: q.notes, commit: q.commit?.slice(0, 7) })),
                tokens: Object.entries(tokensBy(store.messages(id), (m) => `${m.agent}\n${m.model}`)).map(([k, x]) => {
                  const [a, model] = k.split('\n');
                  return `${names[a] ?? a} (${model}): ${x.input} in / ${x.output} out`;
                }),
                windows: windowLines(t.windows),
                git: step.do === 'summary' ? await this.deps.gitState?.(t).catch(() => undefined) : undefined,
              });
          if (!live()) return;
          // The summary reads up to where the build ended, even when it runs again after a restart: what the user wrote
          // later is answered after it (step finish), once.
          turn(MANAGER);
          const r = await this.speak(t, MANAGER, gen, { note, ...(step.do === 'summary' && { until: t.build!.summaryAt }) });
          if (!r) return;
          asker = MANAGER; // a blocked phase waits on the manager's question
          ({ thread: t, step } = afterManager(r.t));
          continue;
        }

        // develop / fix: a developer turn, then Ark's commit and the checks.
        const builder = p.builder;
        if (!builder || !t.roles?.builders.includes(builder)) throw new Error('No builder is assigned to this phase');
        let note: string | undefined;
        if (step.do === 'develop') {
          const base = await ws.head(b.worktree);
          if (!live()) return;
          if (!base) throw new Error('The worktree has no commit');
          t = withPhase(t, (q) => { q.base = base; }).thread;
          this.dropSession(id, builder); // a fresh session per phase
          turn(undefined, [store.append(id, { kind: 'phase', index: b.current, ...(b.cycle && b.cycle > 1 && { cycle: b.cycle }) })]);
        } else {
          note = step.why === 'checks' ? NOTES.checksFailed(step.results ?? []) : step.why === 'review' ? NOTES.fix : NOTES.userFix;
        }
        // The user wrote something the developer has not read: a fresh session starts just before it, and every turn says so.
        const unread = this.unreadByDeveloper(t);
        if (unread !== undefined && !(step.do === 'fix' && step.why === 'user')) note = note ? `${note}
${NOTES.userFix}` : NOTES.userFix;
        // A fresh developer session: its preallowed check commands are fixed when it starts, so ask before.
        if (!this.sessions.get(id)?.has(builder)) {
          await askConsent(b.worktree, ws.projectChecks(b.worktree));
          if (!live()) return;
        }
        turn(builder);
        const setup = setupHints(b.worktree);
        const lead = NOTES.develop({
          plan: b.plan, index: b.current, total: b.phases.length, phase: p.text,
          done: b.phases.slice(0, b.current).map((q) => q.title), branch: b.branch, worktree: b.worktree, setup, checks: ws.projectChecks(b.worktree),
          denied: !this.projectCode(id),
        });
        const r = await this.speak(t, builder, gen, {
          build: { cwd: b.worktree, permissions: 'build', lead, since: Math.min(this.phaseSeq(id, b, b.current), (unread ?? Infinity) - 1) },
          note,
          role: 'builder', level: 'standard',
          timeoutMs: BUILD_TURN_MS,
        });
        if (!r) return;
        t = r.t;
        turn(undefined); // the commit and the checks are Ark's own work: a git failure is not the developer's
        const sha = await ws.commitAll(b.worktree, `ark: phase ${b.current + 1} - ${p.title}`);
        if (!live()) return;
        if (sha) t = withPhase(t, (q) => { q.commit = sha; }).thread; // saved with the checks note
        const checks = ws.projectChecks(b.worktree);
        await askConsent(b.worktree, checks); // checks the developer added during the turn
        if (!live()) return;
        const denied = checks.length > 0 && !this.projectCode(id);
        let results: CheckResult[] = [];
        if (!denied) {
          // halt() aborts these; pause and a permission change wait on `done` before the thread goes idle.
          const ac = new AbortController();
          const done = ws.runChecks(b.worktree, checks, undefined, ac.signal);
          const own = { ac, done };
          this.checks.set(id, own);
          try {
            results = await done;
          } finally {
            if (this.checks.get(id) === own) this.checks.delete(id);
          }
        }
        if (!live()) return;
        const failed = results.filter((x) => !x.ok).map((x) => x.script);
        const skipped = results.filter((x) => x.skipped).map((x) => x.script);
        const passed = results.filter((x) => x.ok && !x.skipped).map((x) => x.script);
        const text = denied ? NOTES.checksDenied : (!results.length ? 'No checks found (npm check scripts, ruff or pytest).'
          : failed.length ? `Checks failed: ${failed.join(', ')}.` : passed.length ? `Checks passed: ${passed.join(', ')}.` : 'No check could run.') +
          (skipped.length ? ` Skipped, tool not installed: ${skipped.join(', ')}.` : '');
        this.save(t, [store.append(id, { kind: 'note', text })]);
        ({ thread: t, step } = afterChecks(t, results, this.unreadByDeveloper(t) !== undefined));
        blockedOn = step.do === 'escalate' ? failed : undefined;
      }
    } catch (e) {
      if (!live()) return; // 'stopped' after a pause, or anything once the thread moved on
      const who = t.speaking;
      if (who) this.dropSession(id, who);
      const note = store.append(id, { kind: 'note', text: `${who ? (names[who] ?? who) : 'The build'} stopped: ${e instanceof Error ? e.message : String(e)}` });
      this.save({ ...t, status: 'error', speaking: undefined }, [note]);
    }
  }
}
