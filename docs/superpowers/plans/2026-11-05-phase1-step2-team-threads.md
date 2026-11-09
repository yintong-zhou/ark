# Ark Phase 1, Step 2 - Team threads - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects and threads. In a thread, the project manager proposes a team, the user approves it, and the team plans together. The manager picks one speaker per turn, any agent can tag the user, the user can reply or react at any time, and the planner's plan ends in a plan card with **Start developer**.

**Architecture:**
- **Shared:** thread types and a few pure view helpers (`src/shared/thread.ts`, `src/shared/thread-view.ts`).
- **Main, `src/main/services/threads/`:**
  - `store.ts` keeps projects, threads and transcripts on disk (spec §11);
  - `protocol.ts` holds the text contract with the agents: the protocol prompts, the Ark notes, how the transcript is formatted for an agent, and the parser for the `ark` block each reply may end with;
  - `rules.ts` is a pure state machine that decides who speaks next, or that the thread waits for the user;
  - `conductor.ts` is the effectful loop that runs the engine sessions through `AgentRunner` and applies the rules.
- **Renderer:** a Threads screen with three columns: projects and threads, the thread, the team.

**Tech Stack:** unchanged from step 1 (Electron, electron-vite, React, TypeScript, Tailwind v4, Vitest, ESLint, `yaml`). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md`. This step covers §4 (projects, threads), §6.1 (sessions and handoffs, planning agents only), §8.1, §8.2, §10 (thread layout, team card, plan card, badge) and §11, plus the points the step-1 handoff deferred (`docs/handoff/2026-11-05-ark-phase1-step1-done.md`, "Dove vogliamo andare" 3). Read §4, §6.1, §8 and §11 first. The mockup is `.superpowers/brainstorm/30747-1793885178/content/thread-team.html`.

**Verified on this machine (2026-11-05), use as given:**
- **Claude Code `result` event:** `modelUsage` is an object keyed by model id, and each value has `contextWindow` (for example `{"claude-haiku-5-5": {…, "contextWindow": 1000000}}`).
- **Codex `thread/tokenUsage/updated`:** `params.tokenUsage` is `{ total, last, modelContextWindow: number | null }` (`.tmp/codex-schema/v2/ThreadTokenUsage.ts`).
- **`run()` in `src/main/services/exec.ts`** has no `cwd`, so Git runs as `run('git', ['-C', dir, 'init'])`.

**Decisions taken here:**
- **The project manager is the catalog agent with id `project-manager`.** A thread can't start without it. The error is: `Add a Project manager agent (id project-manager) to the catalog`.
- **Agents steer the thread with a fenced `ark` block** at the end of their reply, holding one JSON object (Task 5). Ark parses it deterministically. The user sees the reply without the block, plus a card when the block calls for one. This fills spec §14, "the message format sent to each agent" and "how quick replies are encoded".
- **Resuming is replaying.** The spec (§11) asks to resume engine sessions by id. Here, every session start is fresh, whether it's the first one, a restart after Ark was closed, or a 50% handoff. It sends the agent its last handoff summary, if there is one, followed by the transcript after it. This is one mechanism instead of two engine-specific resume paths that were never verified (`--resume`, `thread/resume`). The cost is one replay of a short planning transcript.
- **The plan file lives at `<userData>/threads/<id>/plan.md`,** not in the worktree. Worktrees come in step 3, which copies the plan into `docs/plans/` when the developer starts. The planner stays read-only: its reply *is* the plan, and Ark writes the file.
- **In step 2, Start developer only records the approval.** The phase becomes `build` and the thread shows the note `Plan approved. The developer starts here once build phases ship (step 3).`
- **Reactions never start a turn.** They go into the transcript, and the next speaker reads them.
- **Every agent still runs read-only,** as in step 1. Permissions come in step 3.
- **The single-agent Chat screen stays,** for trying out one agent.
- **Deferred again, to step 3:**
  - the quoting gaps of `spawnCommand` for `.cmd` (they fail closed);
  - the network and scheduling tools still active on read-only agents.

**Out of this step** (do not build):
- worktrees, the developer's build loop, reviews, approval cards (step 3);
- the Auto table, the 90% switch, the movement of the usage windows, the header status line (step 4);
- deleting projects or threads, renaming threads, OS notifications.

## Global Constraints

- Everything in step 1's Global Constraints still holds (`docs/superpowers/plans/2026-11-05-phase1-step1-engines-catalog.md`):
  - Windows only;
  - the window flags `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
  - only the typed `ArkApi` is exposed;
  - every IPC payload is validated in main;
  - runtime data under `app.getPath('userData')`;
  - never write to `~/.claude`, `~/.codex` or `~/.agents`, and never read credential files;
  - engines start through `cleanEnv` / `claudeEnv` and `spawnCommand`;
  - isolation is a hard rule: no retry, no fallback.
- **Do not loosen** `claudeArgs`, `CODEX_BASE_ARGS` or any isolation check. If `npm run test:live` reports an isolation violation, stop and report.
- **The conductor never calls an engine directly.** Everything goes through `AgentRunner.startAgent` / `turn` / `stop`, so every thread session gets step 1's isolation.
- `npm test` never calls a model. Live tests live in `tests/live/`, run only through `npm run test:live`, and use the light tier.
- **Limits, copied from the spec:**
  - planning budget: **20** agent turns without a plan (§8.2);
  - handoff at **50%** of the context window (§6.1);
  - one speaker per turn (§8.2).
- **Brand:**
  - the accent `#00A896` goes only on calls to action: Add project, Start thread, Send, Approve team, Start developer;
  - no "·" between metadata;
  - UI copy in English.
- **Commits:**
  - one commit per task, `git commit -F <file>`;
  - the message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A reply whose `ark` block is missing, malformed, duplicated, or in the middle of the text.** The last block wins. A manager reply without a valid block gets exactly one correction turn, then the thread waits for the user with a note. The thread never loops. Tests: Task 5 (`parseReply` cases) and Task 6 (`one correction, then wait`).
2. **The user writes while an agent is speaking.** The message is saved at once, and when the turn ends it decides who speaks next: the `@mention`, or the manager. It is never lost, and two turns never run in parallel. Test: Task 7 (`user message during a turn routes the next speaker`).
3. **Ark is closed in the middle of a turn.** On the next start the thread is `idle`, with the note `Ark was closed during a turn. Send a message to continue.` The next message starts fresh sessions that replay the transcript. Tests: Task 4 (`recover`) and Task 7 (`fresh session replays from the handoff`).
4. **Pause during a turn.** The running session stops, no reply from it is recorded, and the loop does not go on afterwards. Test: Task 7 (`pause stops the turn and the loop`).
5. **An engine fails mid-thread** (isolation error, exit, timeout). The thread shows a note with the reason, its status becomes `error`, and the user's next message retries with a fresh session. Test: Task 7 (`engine error then retry`).

---

### Task 1: Single instance, reload and ancestor instruction files

The deferred points that touch process and isolation hygiene.

**Files:**
- Modify: `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/services/engines/isolation.ts`, `src/main/services/agent-runner.ts`
- Test: `tests/main/isolation.test.ts`, `tests/main/agent-runner.test.ts`

**Interfaces:**
- Produces: `ancestorInstructions(dir: string): string[]` in `isolation.ts`.

- [ ] **Step 1: Write the failing tests**

In `isolation.test.ts`:
```ts
test('ancestorInstructions lists CLAUDE.md and CLAUDE.local.md above the folder, not in it', () => {
  // root/CLAUDE.md, root/a/CLAUDE.local.md, root/a/b/CLAUDE.md (the folder itself)
  expect(ancestorInstructions(join(root, 'a', 'b')).sort()).toEqual(
    [join(root, 'CLAUDE.md'), join(root, 'a', 'CLAUDE.local.md')].sort(),
  );
});
```
In `agent-runner.test.ts`:
```ts
test('a Claude agent under a folder with CLAUDE.md is refused before spawning', async () => {
  writeFileSync(join(root, 'CLAUDE.md'), 'x'); // root is the parent of project
  const { runner, claudeCalls } = setup();
  await expect(runner.start('tester', project)).rejects.toThrow(/Isolation check failed/);
  expect(claudeCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run tests/main/isolation.test.ts tests/main/agent-runner.test.ts`. Expected: FAIL, `ancestorInstructions` is not exported.

- [ ] **Step 3: Implement**
  - **`ancestorInstructions`:** walk `dirname()` upwards from `resolve(dir)` until the root and collect the existing `CLAUDE.md` / `CLAUDE.local.md` files. The folder itself does not count: the project's own file is kept by design (spec §6.3).
  - **`AgentRunner.startAgent`, Claude branch:** before `buildSkillFolder`, `const above = ancestorInstructions(projectDir); if (above.length) throw new IsolationError(above.map((p) => 'instructions above the project not allowed: ' + p));`. This also covers the drafter in `%TEMP%\ark\drafter`.
  - **`index.ts`:** `if (!app.requestSingleInstanceLock()) app.quit();` before `app.whenReady()`. On `second-instance`, restore and focus the window. Guard the `whenReady` body so a second instance never runs it: that body deletes `<temp>/ark/sessions`.
  - **`ipc/index.ts`:** a `Set<string>` of chat ids started through `chat:start` (removed on `chat:stop`). On `win.webContents.on('did-start-loading')`, stop them all and clear the set. A reload (Ctrl+R) then leaves no orphan sessions.

- [ ] **Step 4: Run the tests and confirm they pass.** Same command, expected PASS. Then run `npm test`: all green.

- [ ] **Step 5: Commit.** `fix: single instance, stop chats on reload, refuse ancestor CLAUDE.md`.

---

### Task 2: Codex re-checks skills every turn; dedupe

**Files:**
- Modify: `src/main/services/engines/codex-session.ts`, `src/main/services/agent-runner.ts`, `src/main/services/engines/isolation.ts`, `src/shared/agent-problems.ts`, `src/main/services/engines/models.ts`, `src/shared/agent-file.ts`, `src/main/services/catalog.ts`, `src/main/ipc/index.ts`
- Test: `tests/main/codex-session.test.ts`, `tests/main/agent-runner.test.ts`, `tests/shared/agent-problems.test.ts`

**Interfaces:**
- Produces:
  - `resolveRun` and `RunPlan` move to `src/shared/agent-problems.ts`; `models.ts` re-exports them, so existing imports keep working;
  - `export const AGENT_ID_RE = /^[a-z0-9-]{1,64}$/` in `agent-file.ts`.

- [ ] **Step 1: Write the failing tests**
  - **`codex-session.test.ts`, `a skill appearing between turns stops the session with an isolation error`:**
    - the fake app-server answers `skills/list` with the private skill only for start and turn 1;
    - after turn 1 completes, it answers with an extra enabled user skill;
    - the second `send()` emits `{type:'error', kind:'isolation'}` whose detail contains `skill not allowed`, and no `turn/start` request is made for it.
  - **`agent-runner.test.ts`, `Claude forbids user skills by folder and by frontmatter name`:**
    - the index has a `claude-user` entry with `folder: 'x-folder'` and `name: 'x-name'`;
    - the `forbidden` passed to `startClaude` contains both.
  - **`agent-problems.test.ts`:** the existing cases still pass when `agentProblems` is built on `resolveRun` (Step 3).

- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run tests/main/codex-session.test.ts tests/main/agent-runner.test.ts`. Expected: the two new tests fail.

- [ ] **Step 3: Implement**
  - **`codex-session.ts` `send()`:** set `busy = true` synchronously, as now. Then `inventory(client, o.cwd)`, then `checkCodexSkills` + `checkCodexMcp`, and only then `turn/start`.
    - A violation: `ended = true; busy = false; client.close(); emit({type:'error', kind:'isolation', detail})`.
    - A failed request emits an `engine` error, as now.
  - **`agent-runner.ts`:** `forbidden` adds both `s.folder` and `s.name` for every `claude-user` skill.
  - **`agent-problems.ts`:**
    - it now holds `resolveRun` and `RunPlan`;
    - `agentProblems` pushes `resolveRun(...).error` when there is one, instead of its own engine checks. Messages are unchanged: `No engine installed`, `<Engine> is not installed`;
    - `models.ts` becomes `export { resolveRun, type RunPlan } from '@shared/agent-problems';` plus its own exports.
  - **`isolation.ts`:** drop the local `isObject` and use `obj` from `../json`.
  - **`AGENT_ID_RE`:** use it in `catalog.ts` (`SAFE_ID`) and in `ipc/index.ts` (`ID`).

- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test` and `npm run typecheck`: green.

- [ ] **Step 5: Commit.** `fix: codex re-checks skills per turn; dedupe run rules and ids`.

---

### Task 3: Turns that return a result, with the context window

**Files:**
- Modify: `src/shared/types.ts`, `src/main/services/engines/claude-session.ts`, `src/main/services/engines/codex-session.ts`, `src/main/services/agent-runner.ts`
- Test: `tests/main/claude-session.test.ts`, `tests/main/codex-session.test.ts`, `tests/main/agent-runner.test.ts`

**Interfaces:**
- Produces:
  - `ChatEvent` `turn` gains `contextWindow?: number`;
  - `export type TurnResult = { text: string; model: string; tokens: TokenCount; contextWindow?: number }` in `types.ts`;
  - `AgentRunner.turn(chatId: string, text: string, timeoutMs = 900_000, timeoutMessage = 'The agent timed out'): Promise<TurnResult>`. The text is the turn's `message` texts joined with `'\n\n'`. It rejects on an `error` event (with its `detail`), on timeout (with `timeoutMessage`), and with `Error('stopped')` when `stop(chatId)` runs while the turn is pending.

- [ ] **Step 1: Write the failing tests**
  - **`claude-session.test.ts`, `turn carries the context window from modelUsage`:** a `result` line with `"modelUsage":{"claude-haiku-5-5":{"contextWindow":1000000}}` produces a `turn` event with `contextWindow: 1000000`. Without `modelUsage`, `contextWindow` is `undefined`.
  - **`codex-session.test.ts`, `turn carries modelContextWindow`:** `thread/tokenUsage/updated` with `tokenUsage: { last: {...}, modelContextWindow: 272000 }` produces `contextWindow: 272000`, and `null` produces `undefined`.
  - **`agent-runner.test.ts`:**
    - `turn resolves with joined messages, model and tokens`: emit `message 'a'`, `message 'b'`, then `turn`, and get `text === 'a\n\nb'`;
    - `turn rejects on error`;
    - `stop rejects a pending turn with "stopped"`;
    - `oneShot still stops the session` (the existing test).

- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run tests/main/claude-session.test.ts tests/main/codex-session.test.ts tests/main/agent-runner.test.ts`.

- [ ] **Step 3: Implement**
  - **Claude:** `contextWindow` is the first `num(obj(v)?.contextWindow)` among the values of `obj(line.modelUsage)`.
  - **Codex:** keep `num(obj(p?.tokenUsage)?.modelContextWindow)` next to `last`.
  - **`AgentRunner`:** keep `pending: Map<chatId, (e: Error) => void>`, and have `stop()` call it with `new Error('stopped')` before stopping. Rewrite `oneShot` as `startAgent` → `turn(chatId, text, timeoutMs, 'The drafter timed out')` → `stop` in a `finally`.

- [ ] **Step 4: Run the tests and confirm they pass.** `npm test` is green.

- [ ] **Step 5: Commit.** `feat: runner turns with result and context window`.

---

### Task 4: Thread types and store

**Files:**
- Create: `src/shared/thread.ts`, `src/main/services/threads/store.ts`
- Test: `tests/main/thread-store.test.ts`

**Interfaces:**
- Produces, in `src/shared/thread.ts`:
```ts
export const MANAGER = 'project-manager';
export const PLANNING_BUDGET = 20;
export const HANDOFF_AT = 0.5;
export type Project = { id: string; name: string; dir: string; git: boolean };
export type Phase = 'team' | 'planning' | 'build' | 'done';
export type ThreadStatus = 'running' | 'waiting' | 'idle' | 'error'; // waiting = for the user
export type Reaction = '👍' | '👎';
export type TeamPick = { agent: string; reason: string };
export type Control =
  | { kind: 'team'; picks: TeamPick[]; leftOut: string }
  | { kind: 'next'; agent: string }
  | { kind: 'ask'; question: string; choices: string[] }
  | { kind: 'plan' };
type Base = { seq: number; at: number };
export type ThreadMessage = Base & (
  | { kind: 'user'; text: string }
  | { kind: 'agent'; agent: string; text: string; model: string; tokens: TokenCount; control?: Control }
  | { kind: 'reaction'; target: number; emoji: Reaction }
  | { kind: 'note'; text: string } // Ark's own line: shown to the user and to the agents
);
export type NewMessage = ThreadMessage extends infer M ? (M extends ThreadMessage ? Omit<M, 'seq' | 'at'> : never) : never;
export type Thread = {
  id: string; projectId: string; title: string; createdAt: number;
  phase: Phase; status: ThreadStatus;
  speaking?: string;                 // agent whose turn is running
  team: string[];                    // approved agent ids, MANAGER first; empty during the team phase
  waitingOn?: string;                // agent that asked the user
  agentTurns: number;                // planning agent turns since the last user message
  retried: boolean;                  // the current speaker already got its one correction
  summarizing: boolean;              // the manager was asked for the budget summary
  cursors: Record<string, number>;   // last seq each agent's live session has seen
  handoffs: Record<string, { seq: number; text: string }>;
};
export type ThreadUpdate = { thread: Thread; added: ThreadMessage[] };
```
- Produces, `ThreadStore` in `store.ts` (the root is `userData`, layout from spec §11):
  - `projects(): Project[]`;
  - `addProject(dir: string): Project`: the same resolved `dir` returns the existing project; `name = basename(dir)`; `git = existsSync(join(dir, '.git'))`;
  - `setGit(id: string): Project`: re-reads `.git`;
  - `threads(): Thread[]`, newest first;
  - `get(id: string): Thread | undefined`;
  - `create(projectId: string, title: string): Thread`: uuid id, phase `team`, status `idle`, zero counters, empty maps. It throws `Unknown project` for an unknown project;
  - `save(t: Thread): void`: `writeAtomic` to `threads/<id>/thread.json`;
  - `messages(id: string): ThreadMessage[]`: reads `threads/<id>/messages.jsonl` and skips lines that don't parse;
  - `append(id: string, m: NewMessage): ThreadMessage`: `seq` is the last seq + 1 (the last seq is cached per thread after the first read), `at = Date.now()`, then `appendFileSync`;
  - `writePlan(id: string, text: string): string`: writes `threads/<id>/plan.md` and returns the path;
  - `recover(): void`: for each thread with status `running`, sets status `idle`, clears `speaking` and `cursors` (the sessions are gone), and appends the note `Ark was closed during a turn. Send a message to continue.`

- [ ] **Step 1: Write the failing tests** in `tests/main/thread-store.test.ts`, on a `mkdtemp` root:
  - `addProject dedupes by folder and detects git`;
  - `create rejects an unknown project`;
  - `append numbers messages from 1 and survives a new store instance` (two appends; a new `ThreadStore` on the same root continues at 3);
  - `messages skips a corrupt line` (write a garbage line between two valid ones);
  - `recover turns running into idle, clears speaking and cursors, and adds the note`;
  - `threads are listed newest first`.

- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run tests/main/thread-store.test.ts`.

- [ ] **Step 3: Implement** `store.ts`. Use `writeAtomic` (`files.ts`) for `projects.json` and `thread.json`, and `randomUUID` for the ids. Guard the thread ids used in paths with the UUID regex; an invalid one throws `Unknown thread`.

- [ ] **Step 4: Run the tests and confirm they pass.**

- [ ] **Step 5: Commit.** `feat: thread types and on-disk store`.

---

### Task 5: The agent protocol

**Files:**
- Create: `src/main/services/threads/protocol.ts`
- Test: `tests/main/thread-protocol.test.ts`

**Interfaces:**
- Consumes: the types from Task 4, and `AgentDef`.
- Produces:
  - `parseReply(text: string): { body: string; control?: Control; error?: string }`;
  - `withProtocol(agent: AgentDef): AgentDef`: the same agent with `MANAGER_PROTOCOL` (when `agent.id === MANAGER`) or `MEMBER_PROTOCOL` appended to `prompt` after a blank line;
  - `formatForAgent(unseen: ThreadMessage[], all: ThreadMessage[], names: Record<string, string>, self: string): string`;
  - `NOTES`, as listed in Step 3.

- [ ] **Step 1: Write the failing tests**
```ts
const block = (o: unknown) => 'Text.\n\n```ark\n' + JSON.stringify(o) + '\n```';
test('no block: body only', () => expect(parseReply('hello')).toEqual({ body: 'hello' }));
test('next', () => expect(parseReply(block({ next: 'planner' }))).toEqual({ body: 'Text.', control: { kind: 'next', agent: 'planner' } }));
test('team defaults leftOut', () => expect(parseReply(block({ team: [{ agent: 'seo', reason: 'r' }] })).control)
  .toEqual({ kind: 'team', picks: [{ agent: 'seo', reason: 'r' }], leftOut: '' }));
test('ask defaults choices', () => expect(parseReply(block({ ask: 'Q?' })).control).toEqual({ kind: 'ask', question: 'Q?', choices: [] }));
test('plan', () => expect(parseReply(block({ plan: true })).control).toEqual({ kind: 'plan' }));
test('last block wins and both are removed from the body', () => {
  const r = parseReply(block({ next: 'a' }) + '\n' + block({ next: 'b' }));
  expect(r.control).toEqual({ kind: 'next', agent: 'b' });
  expect(r.body).not.toContain('```ark');
});
test.each([
  ['```ark\nnot json\n```', 'ark block: not valid JSON'],
  [block({ next: 'a', ask: 'q' }), 'ark block: use exactly one of team, next, ask, plan'],
  [block({ team: [] }), 'ark block: team needs at least one pick'],
  [block({ ask: 'q', choices: ['1', '2', '3', '4', '5'] }), 'ark block: at most 4 choices'],
])('invalid %s', (text, error) => expect(parseReply(text).error).toBe(error));
test('formatForAgent skips own messages and labels the rest', () => {
  // all: 1 user 'hi', 2 agent planner 'p', 3 agent project-manager 'm', 4 reaction 👍 on 2, 5 note 'n'
  expect(formatForAgent(all.slice(0), all, { planner: 'Planner', 'project-manager': 'Project manager' }, 'project-manager'))
    .toBe('[User] hi\n\n[Planner] p\n\n[User reacted 👍 to Planner: "p"]\n\n[Ark] n');
});
test('withProtocol appends the manager protocol only to the manager', ...);
```
  - **More `parseReply` rules:**
    - `choices` items are trimmed, non-empty, at most 60 characters each;
    - a `reason` is a non-empty string;
    - an `ask` question is a non-empty string;
    - `plan` must be `true`.
  - **More `formatForAgent` rules:**
    - an agent message whose control is an `ask` renders as `[Name] body\n(asked the user: question)`;
    - a reaction quotes at most the first 80 characters of its target, followed by `…` when cut.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.** Find the blocks with ``/```ark\s*\n([\s\S]*?)\n```/g``. The last one is parsed, and every one is removed from `body`, which is then trimmed.

The protocol texts are exact copy:
```ts
export const MANAGER_PROTOCOL = `# Working in an Ark thread
You are the project manager of this thread: a conversation between the user and a team of agents. Ark relays it. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark.
End every reply with exactly one Ark block: a fenced code block tagged ark holding one JSON object.
- Team phase (Ark tells you): {"team":[{"agent":"<id>","reason":"<one line>"}],"leftOut":"<one line on the obvious agents you left out>"}. Pick only ids from the catalog Ark lists, never yourself.
- To give the floor to one team member: {"next":"<id>"}. One agent speaks per turn; after they reply it is your turn again.
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]}. choices is optional, at most 4. The team waits for the answer.
When the team agrees on what to build, give the floor to the planner to write the plan.`;
export const MEMBER_PROTOCOL = `# Working in an Ark thread
You are a member of this thread's team, led by the project manager. Ark relays the conversation. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark. You speak only when the project manager gives you the floor: answer what you were asked, briefly.
You may end your reply with one Ark block, a fenced code block tagged ark holding one JSON object:
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]} (choices optional, at most 4).
- When your reply is the complete plan in Markdown, split into phases each with its goal and its checks: {"plan":true}
Without a block the floor goes back to the project manager.`;
export const NOTES = {
  teamStart: (project: string, dir: string, catalog: AgentDef[]) =>
    `The user started a thread in project ${project} (${dir}). Propose the team.\nCatalog:\n` +
    catalog.filter((a) => a.id !== MANAGER).map((a) => `- ${a.id}: ${a.name}. ${a.description}`).join('\n'),
  roster: (team: { id: string; name: string }[]) => `Team: ${team.map((a) => `${a.id} (${a.name})`).join(', ')}.`,
  teamApproved: (names: string[]) => `The user approved the team: ${names.join(', ')}. Lead the planning.`,
  invalid: (error: string) => `Your reply had no valid Ark block (${error}). Reply again, ending with one valid Ark block.`,
  budget: `${PLANNING_BUDGET} agent turns without a plan. Write the user a short summary of where the discussion stands and ask how to continue.`,
  handoff: `Your session is getting long. Write a handoff for yourself: what the thread is about, what was decided, what is open, and what you were doing. Ark starts you in a fresh session from it. No Ark block.`,
  fresh: (handoff: string) => `You are continuing this thread in a fresh session. Your handoff:\n${handoff}`,
};
```

- [ ] **Step 4: Run the tests and confirm they pass.**

- [ ] **Step 5: Commit.** `feat: thread protocol for agents`.

---

### Task 6: Turn rules

**Files:**
- Create: `src/main/services/threads/rules.ts`
- Test: `tests/main/thread-rules.test.ts`

**Interfaces:**
- Consumes: the Task 4 types, and `NOTES` from Task 5.
- Produces:
```ts
export type Step = { do: 'turn'; agent: string; note?: string } | { do: 'wait'; note?: string } | { do: 'idle' };
export type Decision = { thread: Thread; step: Step };
export function afterReply(t: Thread, from: string, control: Control | undefined, error: string | undefined, interrupt?: { to?: string }): Decision;
export function afterUser(t: Thread, mention: string | undefined): Decision;
export function approveTeam(t: Thread, picks: string[], names: Record<string, string>): Decision;
export function mentionOf(text: string, team: string[]): string | undefined; // first @<id> whose id is in team
export function needsHandoff(tokens: TokenCount, contextWindow: number | undefined): boolean; // input / window >= HANDOFF_AT
```
  - `Step.wait.note` is a line the conductor appends as a `note` message.
  - `waitingOn`, `status` and `speaking` are set by the conductor from the step. The rules only return the counters, the phase and the team.

**The rules,** where `t` is the thread before the reply and `PM` is `MANAGER`:

`afterReply`:
1. **The budget summary.** `from === PM && t.summarizing` → `wait`, `summarizing = false`. The control and the error are ignored.
2. **What needs a correction.** A reply needs one when `error` is set, or when `from === PM` and the control isn't valid for the phase:
   - in `team`, the valid controls are `team` and `ask`;
   - in `planning`, the valid controls are `next` to a team member other than PM, `ask` and `plan`.

   If `!t.retried`, the step is `turn` to the same agent with note `NOTES.invalid(error ?? 'missing or not allowed here')`, and `retried = true`. Otherwise the step is `wait` with note `<from> did not give Ark a valid instruction. Reply to continue.`, and `retried = false`.
3. **Otherwise** `retried = false`.
   - In `planning`, `agentTurns + 1`.
   - The step comes from the control:
     - `team`, `ask` or `plan` → `wait`;
     - `next` → `turn` to that agent;
     - a member reply with no control, or with `next`/`team` → `turn` to PM. Members can't steer the thread, so those controls are ignored.
4. **An interrupt.** If one is given and the step is `turn`, the step becomes `turn` to `interrupt.to ?? PM`, and `agentTurns = 0`.
5. **The budget.** If the phase is `planning`, the step is still `turn`, and `agentTurns >= PLANNING_BUDGET`, then the step becomes `turn` to PM with note `NOTES.budget`, and `summarizing = true`.

`afterUser`: `agentTurns = 0`, `retried = false`, and then by phase:
- `team` → `turn` PM;
- `planning` → `turn` to `mention ?? t.waitingOn ?? PM`;
- `build` / `done` → `idle`.

`approveTeam`: `team = [PM, ...unique(picks).filter((id) => id !== PM)]`, `phase = 'planning'`, `agentTurns = 0`. The step is `turn` PM with note `NOTES.teamApproved(team.map((id) => names[id] ?? id))`.

- [ ] **Step 1: Write the failing tests.** One test per numbered rule, plus:
  - `next to an agent outside the team needs a correction`;
  - `next to the manager itself needs a correction`;
  - `one correction, then wait` (two invalid replies in a row → `turn`, then `wait` with the note);
  - `budget: the 20th planning turn hands the floor to the manager for a summary, whose reply waits`;
  - `afterUser in planning prefers the mention, then the agent that asked`;
  - `mentionOf ignores ids outside the team and e-mail addresses` (`a@planner.com` is not a mention: require start-of-text or whitespace before `@`);
  - `needsHandoff is false without a window and true at exactly 50%`.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement** the pure functions. No I/O, no `Date.now()`.

- [ ] **Step 4: Run the tests and confirm they pass.**

- [ ] **Step 5: Commit.** `feat: thread turn rules`.

---

### Task 7: Conductor

**Files:**
- Create: `src/main/services/threads/conductor.ts`
- Test: `tests/main/conductor.test.ts`

**Interfaces:**
- Consumes:
  - `ThreadStore` (Task 4);
  - `parseReply`, `withProtocol`, `formatForAgent`, `NOTES` (Task 5);
  - the rules (Task 6);
  - `AgentRunner.startAgent` / `turn` / `stop` and `TurnResult` (Task 3).
- Produces:
```ts
export type ConductorDeps = {
  store: ThreadStore;
  catalog: Pick<Catalog, 'get' | 'list'>;
  runner: Pick<AgentRunner, 'startAgent' | 'turn' | 'stop'>;
};
export class Conductor {
  constructor(deps: ConductorDeps);
  create(projectId: string, text: string): Thread; // title = first line of text, max 60 chars
  send(threadId: string, text: string): void;
  approveTeam(threadId: string, agentIds: string[]): void;
  react(threadId: string, seq: number, emoji: Reaction): void;
  startDeveloper(threadId: string): void;
  pause(threadId: string): void;
  stopAll(): void;
  onUpdate(cb: (u: ThreadUpdate) => void): () => void;
}
```
  - Every public method validates the thread's state and throws a readable `Error`:
    - `approveTeam` requires `phase === 'team' && status === 'waiting'`;
    - `startDeveloper` requires `phase === 'planning'` and the last agent message to be a plan;
    - `react` requires `seq` to be an existing agent message;
    - `create` requires `MANAGER` in the catalog (error: `Add a Project manager agent (id project-manager) to the catalog`).
  - Public methods return as soon as the state is saved. Turns run in a background loop, and failures inside it become notes, never rejections.

**Behaviour:**
- **Every change** is `store.save` / `store.append` followed by one `ThreadUpdate` to the listeners, with the messages it added.
- **`create`:** appends the user message, then starts the loop with `turn` PM and note `NOTES.teamStart(project.name, project.dir, catalog.list().agents)`.
- **`send`:**
  - it always appends the user message first;
  - if `status === 'running'`, it records `interrupt = { to: mentionOf(text, t.team) }` for the thread and returns;
  - otherwise it applies `afterUser` and runs the step.
- **`approveTeam`:** checks that every id is in the catalog (error: `Unknown agent: <id>`), then applies `approveTeam` and appends the note `Team approved: <names>.`
- **`react`:** only appends. It never starts a turn.
- **`startDeveloper`:** `phase = 'build'`, `status = 'idle'`, then the note `Plan approved. The developer starts here once build phases ship (step 3).`
- **`pause`:** `status = 'idle'`, `speaking` cleared, and the `generation` counter bumped. It stops the speaking agent's session; the pending `turn` then rejects with `stopped` and nothing is recorded. It does not resume on its own.
- **The loop, per thread,** guarded by a `generation` number. After every `await`, it returns if the number changed. For each `turn` step:
  1. Set `status = 'running'`, `speaking = agent`, `waitingOn = undefined`.
  2. **The session.** Keep one live session per thread and agent, as `Map<threadId, Map<agentId, chatId>>`. If none is live, `runner.startAgent(withProtocol(catalog.get(agent)), project.dir)`. A session started this way is *fresh*.
  3. **The input.**
     - The last seen seq is `fresh ? (handoffs[agent]?.seq ?? 0) : cursors[agent]`, and the unseen messages are the ones after it.
     - The text is joined with `\n\n`:
       - when fresh, `[Ark] ` + `NOTES.fresh(handoff)` if there is a handoff, and `[Ark] ` + `NOTES.roster(...)` once the team is approved;
       - `formatForAgent(unseen, all, names, agent)`;
       - `[Ark] ` + `note`, when the step has one.
  4. `result = await runner.turn(chatId, text)`, then `parseReply(result.text)`.
  5. **The reply.**
     - Append the agent message (`text: body`, `model`, `tokens`, `control`). A `plan` control also gets `store.writePlan(id, body)`.
     - Set `cursors[agent]` to the new message's seq.
  6. **The handoff.** If `needsHandoff(result.tokens, result.contextWindow)`:
     - `h = await runner.turn(chatId, '[Ark] ' + NOTES.handoff)`;
     - `handoffs[agent] = { seq: <new message seq>, text: h.text }`;
     - `runner.stop(chatId)`, and forget the session.
  7. **The next step.** `afterReply(t, agent, control, error, interrupt)`, then clear the interrupt.
     - `turn` loops back to step 1.
     - `wait` sets `status = 'waiting'`, `waitingOn = agent` when the control was an `ask` (otherwise leaves it unset), clears `speaking`, and appends `step.note` if there is one.
     - `idle` sets `status = 'idle'`.
- **When something fails in the loop** (`startAgent` or `turn` rejects with anything except `stopped` after a pause):
  - append the note `<Name> stopped: <readable message>`;
  - set `status = 'error'` and clear `speaking`;
  - stop and forget that agent's session.

  `afterUser` from `error` works like from `idle`, so the next message retries with a fresh session.
- **`stopAll`:** bump every generation, stop every live session, and save each `running` thread as `idle`. `store.recover()` covers a crash.

- [ ] **Step 1: Write the failing tests.** Use a fake runner:
  - `startAgent` returns `{chatId: 'c<n>', engine: 'claude', model: 'haiku'}` and records the agent it got;
  - `turn(chatId, text)` records the text and resolves from a queue of scripted replies per agent id;
  - `stop` records the chat id and rejects that chat's pending turn with `Error('stopped')`.

  Use a real `ThreadStore` on a `mkdtemp` root and a fake catalog with the seed agents. Await an `idle()` helper that resolves when no loop is running. The tests:
  - `create runs the manager with the catalog and waits on its team card`: the first `turn` text contains `[User] <text>` and `Catalog:`; status `waiting`; the last message's control kind is `team`; the manager's prompt contains `# Working in an Ark thread`;
  - `approve then planning: manager gives the floor, member replies, floor returns to manager`: the scripted PM `next: planner`, then planner text, then PM `ask` → turns in order PM, planner, PM, then status `waiting` and `waitingOn` PM;
  - `the member's second turn only gets what it has not seen` (no repeat of `[User] <first text>`);
  - `plan reply writes plan.md and waits; startDeveloper moves to build with the note`;
  - `user message during a turn routes the next speaker` (send `@seo …` while the PM's turn is pending; PM replies `next: planner`; the next turn is `seo`);
  - `pause stops the turn and the loop` (pause while pending → no new agent message, no further `turn`, status `idle`);
  - `engine error then retry` (`turn` rejects `exit code 1` → note `Planner stopped: exit code 1`, status `error`; then `send` starts a fresh session whose text contains the earlier transcript);
  - `fresh session replays from the handoff` (a result with `tokens.input = 600`, `contextWindow = 1000` → a handoff turn, `stop`, then the next turn for that agent starts a new session whose text starts with `[Ark] You are continuing this thread in a fresh session.` and contains only the messages after the handoff seq);
  - `react records and does not start a turn`;
  - `approveTeam outside the team phase throws`.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement** `conductor.ts` following the behaviour above. Add one `ponytail:` comment: live sessions stay open until the thread pauses, fails or Ark quits; stopping idle threads' sessions is the upgrade if the process count matters.

- [ ] **Step 4: Run the tests and confirm they pass.** `npm test` is green.

- [ ] **Step 5: Commit.** `feat: thread conductor`.

---

### Task 8: IPC, preload and wiring

**Files:**
- Modify: `src/shared/types.ts` (`ArkApi`), `src/preload/index.ts`, `src/main/ipc/index.ts`, `src/main/index.ts`

**Interfaces:**
- Produces, in `ArkApi`:
```ts
projects: {
  list(): Promise<Project[]>;
  add(dir: string): Promise<Project>;
  gitInit(id: string): Promise<Project>;
};
threads: {
  list(): Promise<Thread[]>;
  open(id: string): Promise<{ thread: Thread; messages: ThreadMessage[] }>;
  create(projectId: string, text: string): Promise<Thread>;
  send(id: string, text: string): Promise<void>;
  approveTeam(id: string, agentIds: string[]): Promise<void>;
  react(id: string, seq: number, emoji: Reaction): Promise<void>;
  startDeveloper(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  onUpdate(cb: (u: ThreadUpdate) => void): () => void;
};
```
- **Channels:** `projects:list|add|git-init`, `threads:list|open|create|send|approve-team|react|start-developer|pause`, and the event `threads:update`. The folder picker is the existing `chat:pick-folder`.

- [ ] **Step 1: Add the validators to `ipc/index.ts`:**
  - project and thread ids: `UUID`;
  - `dir`: the existing `projectDir()`;
  - text: 1–100 000 characters, as for `chat:send`;
  - `agentIds`: an array of 1–20 strings matching `AGENT_ID_RE`;
  - `seq`: an integer of at least 1;
  - `emoji`: `👍` or `👎`.

  `projects:git-init` looks the project up first (`Unknown project`), runs `run('git', ['-C', dir, 'init'])`, and returns `store.setGit(id)`. It rejects with `git init failed` when the result is not ok.

- [ ] **Step 2: Wire `index.ts`:**
  - `const store = new ThreadStore(userData); store.recover();`
  - `const conductor = new Conductor({ store, catalog, runner });`
  - pass both to `registerIpc`, and forward `conductor.onUpdate` to `win.webContents.send('threads:update', u)` while the window is alive;
  - in `before-quit`, add `() => conductor.stopAll()` *before* `runner.stopAll()`.

- [ ] **Step 3: Add the preload functions,** mapping each `ArkApi` function to its channel. `onUpdate` follows the `chat.onEvent` listener pattern.

- [ ] **Step 4: Verify.** Run `npm run typecheck`, `npm run lint` and `npm test`: green.

- [ ] **Step 5: Commit.** `feat: projects and threads over IPC`.

---

### Task 9: Threads screen

**Files:**
- Create: `src/shared/thread-view.ts`, `src/renderer/hooks/useThreads.ts`, `src/renderer/pages/Threads.tsx`, `src/renderer/components/ThreadView.tsx`, `src/renderer/components/TeamPanel.tsx`
- Modify: `src/renderer/agents.ts` (`Screen` gains `{ name: 'threads' }`), `src/renderer/App.tsx`, `src/renderer/pages/Usage.tsx` (a `Threads` link next to `Agents`)
- Test: `tests/shared/thread-view.test.ts`

**Interfaces:**
- Produces, in `thread-view.ts` (pure):
  - `actionable(t: Thread, messages: ThreadMessage[]): { kind: 'team' | 'ask' | 'plan'; seq: number } | undefined`. It returns the last agent message, if its control is `team`, `ask` or `plan` and `t.status === 'waiting'`. `plan` also requires `t.phase === 'planning'`;
  - `reactionsOf(messages): Map<number, Reaction>`: the last reaction per target wins;
  - `tokensByAgent(messages): Record<string, TokenCount>`: summed over the agent messages;
  - `lastModel(messages, agent): string | undefined`.

- [ ] **Step 1: Write the failing tests** in `tests/shared/thread-view.test.ts`:
  - `actionable only for the last message while waiting`;
  - `a plan card is not actionable after the phase moved to build`;
  - `last reaction wins`;
  - `tokens sum per agent`.

- [ ] **Step 2: Run them and confirm they fail.** Then implement `thread-view.ts` and run them again: PASS.

- [ ] **Step 3: Build the UI,** following the layout of `thread-team.html` and the step-1 class constants (`FIELD`, `BUTTON`, `CTA` in `Chat.tsx`; reuse them, do not restyle).
  - **`useThreads`** loads `projects.list` and `threads.list` and keeps the selected thread with its messages (`threads.open`). It subscribes to `threads.onUpdate`, which replaces the thread in the list and, for the selected thread, appends `added` (skipping any seq it already has).
  - **`Threads.tsx`** is three columns:
    - **left:** projects, each with its threads. A thread with `status === 'waiting'` shows the badge `waiting for you`. **Add project** (CTA) uses `chat.pickFolder`, then `projects.add`. A project with `git: false` shows **Initialize Git** (a plain button), which calls `projects.gitInit`. Each project has **New thread**;
    - **middle:** with a new thread selected, a textarea `What do you want to work on?` and **Start thread** (CTA). Otherwise `ThreadView`;
    - **right:** `TeamPanel`.
  - **`ThreadView`:**
    - a header with the title and the phase;
    - the messages: `You`, the agent name with `lastModel` as a tag, Ark notes in muted text;
    - 👍 and 👎 buttons on agent messages, with the current reaction highlighted;
    - the cards, actionable only for the message `actionable` returns:
      - **team card:** picks with their reasons, then `leftOut`, then **+ add from catalog** (a `<select>` of catalog agents not yet picked and not the manager), then **Approve team** (CTA);
      - **ask card:** the question and one chip per choice; a click sends the choice text;
      - **plan card:** the plan in a collapsed `<details>` and **Start developer** (CTA);
    - **the composer:** one chip per team member that inserts `@<id> `, a textarea (Enter sends, Shift+Enter is a new line), **Send** (CTA), and **Pause** (a plain button) while `status === 'running'`. Errors from IPC calls show with `readable()` under the composer, as in `Chat.tsx`.
  - **`TeamPanel`:** one row per team member (during the team phase, only the manager). Each row has the name, `lastModel`, and a state: `speaking` when `thread.speaking === id`, `waiting for you` when `waitingOn === id`, `idle` otherwise. It also shows `in/cached/out` from `tokensByAgent`, formatted as in `Chat.tsx`.

- [ ] **Step 4: Verify.** Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`: green. Then `npm run dev` and check that the Threads screen renders, that Add project works on a scratch folder, and that the badge and the cards render on a thread created through the UI. This is the user's part if the native picker blocks automation (step-1 handoff).

- [ ] **Step 5: Commit.** `feat: threads screen`.

---

### Task 10: Live thread check and docs

**Files:**
- Create: `tests/live/thread.live.test.ts`
- Modify: `README.md` (a `Threads` section after `Agents`), `docs/handoff/` (a new handoff written with the `handoff` skill)

- [ ] **Step 1: Write the live test.**
  - **Setup:** a real `AgentRunner`, built the way `index.ts` builds it, plus a `ThreadStore` on a `mkdtemp` root and a `Catalog` seeded with `SEED_AGENTS`. The project is a `mkdtemp` folder with `git init`.
  - **The test:** create a thread with `Add a one-paragraph README to this empty repository.`, then wait at most 180 s for `status !== 'running'`.
  - **Assertions:** the status is `waiting`, the last agent message is from `project-manager` with control `team` or `ask`, its model contains `haiku`, and there are no notes containing `stopped`.
  - **Cleanup:** `conductor.stopAll()` and `runner.stopAll()` in `afterAll`.

- [ ] **Step 2: Run it.** Run `npm run test:live`: all live tests pass, the old ones included, with no isolation violations. If the manager's block keeps failing to parse, fix the protocol text (Task 5), not the parser's strictness.

- [ ] **Step 3: Manual check, which needs the user** (spec §13, up to the plan card):
  1. In `npm run dev`, add a throwaway repo, start a thread, and approve the team.
  2. Answer one `@you` with a chip and react 👍 to one message.
  3. Get to the plan card and press Start developer.
  4. Close Ark while a turn is running and reopen it. Check the `Ark was closed during a turn` note, then send a message and see the thread continue.
  5. Check that `Get-Process claude,codex` is empty after quitting.

- [ ] **Step 4: Write the README section** (Threads: what a project and a thread are, the team phase, `@you`, reactions, the plan card, and that building arrives in step 3). Then write the handoff.

- [ ] **Step 5: Commit.** `test: live thread check; docs: threads`.
