# Ark Phase 1, Step 3 — Build phases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start developer creates a Git worktree on a new branch. The developer builds the plan phase by phase, and every phase goes through development → checks → code review → security review. Two rounds without agreement send the problem to the user. Risky actions ask the user through an approval card, and the project manager closes the thread with a summary.

**Architecture:**
- **Shared** (`src/shared/thread.ts`): build state on the thread, three new message kinds (`phase`, `approval`, `decision`) and the `review` control.
- **Main, `src/main/services/threads/`:**
  - `workspace.ts` (new) holds everything Ark does in a worktree: Git and the project's checks;
  - `build-rules.ts` (new) is a pure state machine for the build loop, the twin of `rules.ts`;
  - `protocol.ts` gets the developer and reviewer prompts, the build notes, the `review` block and the plan-phase parser;
  - `conductor.ts` runs the build loop and routes approvals.
- **Engines:** a `build` permission profile on both engines. Approvals travel as a new `ChatEvent` (`approval`), and the answer goes back through `EngineSession.answer`.
- **Renderer:** phase cards, approval cards, and a badge for threads that wait on an approval.

**Tech Stack:** unchanged (Electron, electron-vite, React, TypeScript, Tailwind v4, Vitest, ESLint, `yaml`). No new dependency. Git and npm are the ones installed on the machine.

**Spec:** `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md`. This step covers §6.1 (developer and reviewer sessions), §6.4, §8.3, §10 (phase cards, approval cards) and §11 (plan in the worktree). Read §6.1, §6.4 and §8.3 first. Mockup: `.superpowers/brainstorm/30747-1793885178/content/build-phases.html`, if it is still on disk. Step 2's plan (`docs/superpowers/plans/2026-11-05-phase1-step2-team-threads.md`) explains the conductor, the rules and the `ark` block.

**Verified on this machine (2026-11-06, Claude Code 2.1.312, Codex CLI 0.132.0), use as given:**
- **Claude permission prompts.** By default `claude -p` with stream-json denies on its own anything that would prompt (tool result `This command requires approval`). With `--permission-prompt-tool stdio`, it writes this to stdout instead:
  ```json
  {"type":"control_request","request_id":"<uuid>","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"npm install left-pad","description":"Install left-pad npm package"},"description":"Install left-pad npm package","decision_reason":"This command requires approval","tool_use_id":"toolu_…"}}
  ```
  It waits for a line on stdin. The verified deny answer is `{"type":"control_response","response":{"subtype":"success","request_id":"<uuid>","response":{"behavior":"deny","message":"…"}}}`. The allow answer is the same with `{"behavior":"allow","updatedInput":<the request's input>}`; it was sent, but the command it was tested on did not prompt, so the live test in Task 8 has to confirm it.
- **`--permission-mode acceptEdits`** lets Write and Edit work inside the session's cwd without a prompt.
- **`--tools Read,Edit,Write,Glob,Grep,Bash,PowerShell`** is a whitelist: the `system/init` `tools` list holds exactly those. Without it, the session also gets Cron, Workflow, SendMessage, WebFetch, AskUserQuestion and others.
- **Codex server requests** (`codex app-server generate-ts`):
  - `item/commandExecution/requestApproval` has params `{threadId, turnId, itemId, reason?, command?, cwd?}` and the answer `{decision: "accept" | "decline"}`;
  - `item/fileChange/requestApproval` has params `{threadId, turnId, itemId, reason?, grantRoot?}` and the same answer;
  - `item/permissions/requestApproval` exists too, and Ark answers it with the JSON-RPC error it already sends for any unknown request (a denial);
  - `thread/start` takes `sandbox: "workspace-write"` and `approvalPolicy: "on-request"`.

**Decisions taken here** (spec §14 leaves them to the builder):
- **Worktree path:** `<userData>/worktrees/<first 8 chars of thread id>`. It is short, because Windows paths cap at 260 characters and `node_modules` is deep. The branch is `ark/<slug of the title, at most 40 chars>-<first 8 chars of thread id>`, with the slug from `agentId()` in `@shared/agent-file`.
- **The plan is copied** to `<worktree>/docs/plans/<YYYY-MM-DD>-<slug>.md` and committed as the branch's first commit (`docs: plan for <title>`). Phase 1's diff starts after it.
- **Ark commits, not the developer.** After every developer turn Ark runs `git add -A` and commits `ark: phase <n> — <title>` when something changed. The phase diff is then `git diff <phase base> HEAD`, which also covers new files. The developer is told not to commit. In a worktree `.git` points outside the folder, so a commit would prompt anyway.
- **Ark runs the checks itself** after every developer turn: the `typecheck`, `lint`, `test` and `build` scripts in the worktree's `package.json`, whichever exist, in that order, through `npm run <script>`. This is the deterministic gate behind "the phase cannot leave this step while checks fail" (spec §8.3). A project with no `package.json` or none of those scripts has no checks, and the phase card says so. The card lists the scripts that passed instead of "tests n/n": counting tests depends on the framework.
- **Dependencies:** a new worktree has no `node_modules`. The developer is told to run `npm ci` first when it is missing. That is an approval card the user clicks once per thread. Ark never installs anything itself.
- **Rounds.** A phase has one counter, `rounds`. It goes up each time the developer is sent back, either because checks failed or because a review asked for changes. When a failure arrives and `rounds` already equals `REVIEW_ROUNDS` (2), the phase is `blocked`: the project manager gets a turn to tag the user with the open points (spec §8.3.4), and the thread waits. The user's reply resets `rounds` to 0 and sends the developer back to work.
- **Both reviews always run** (code, then security) before the developer gets the findings of either.
- **Build roles are fixed catalog ids:** `developer`, `code-reviewer`, `security-reviewer`. Start developer adds the ones missing from the team, with a note, and refuses when the catalog lacks one. This keeps the anti-goal that no phase ends without review and security review. It also refuses when `developer` does not have `permissions: build`.
- **Sessions** (spec §6.1):
  - developer: a fresh session per phase, kept across that phase's fix rounds and stopped when the phase ends;
  - reviewers: a fresh session per review, stopped right after the reply;
  - manager: keeps its planning session.

  Fresh build sessions see no transcript, only their note. Later developer turns in the same phase see the unseen messages as today, which include the reviewers' findings.
- **Reviewer verdict:** reviewers end with `{"review":"pass"}` or `{"review":"changes","findings":["…"]}`. A bad block gets the one correction from step 2. A second bad reply makes the thread wait with a note.
- **Plan phases:** a plan phase is any Markdown heading of level 1–3 shaped `<word> <number>: <title>` (`.`, `-`, `–` or `—` also work as separators). So `## Phase 1: Setup` and `## Fase 1: Setup` both count, because agents write in the user's language. A plan with no phase is a bad block (`ark block: plan has no "## Phase N: <title>" headings`) and gets the usual correction.
- **Approvals:**
  - the card shows the agent, the tool, and the command or file;
  - pending approval seqs live on `Thread.approvals`, while `status` stays `running`, and the badge shows when `status === 'waiting'` or `approvals` is not empty;
  - an approval still pending when its turn ends, when the thread is paused or when Ark closes is dropped from `approvals`, and its card shows "Expired".
- **Turn timeout for build turns:** 1 hour (`BUILD_TURN_MS = 3_600_000`), waiting for approvals included. The 15-minute default still applies to everything else.
- **Final summary:** a manager turn with a note that carries the branch, each phase with its review-note count and commit, and the tokens per agent (`tokensByAgent` from `@shared/thread-view`). The movement of the usage windows waits for step 4. After the reply the thread is `done`.
- **Read-only agents move to a whitelist too:** `--tools Read,Glob,Grep,Skill` replaces `--disallowedTools …`. This closes the deferred "network and scheduling tools still active on read-only agents". The live isolation test proves that skills still load.

**Out of this step** (do not build):
- Auto routing, the 90% switch, the usage-window movement, the header status line (step 4);
- merging the branch, deleting worktrees, any other Git UI (Phase 3);
- counting tests, killing a check that is already running when the user pauses;
- the step-2 deferred items not named in Task 4 or Task 8.

## Global Constraints

- Everything in step 1's and step 2's Global Constraints still holds:
  - Windows only;
  - the window flags `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
  - only the typed `ArkApi` is exposed, and every IPC payload is validated in main;
  - runtime data under `app.getPath('userData')`;
  - never write to `~/.claude`, `~/.codex` or `~/.agents`, and never read credential files;
  - engines start through `cleanEnv` / `claudeEnv` and `spawnCommand`;
  - isolation is a hard rule: no retry, no fallback. If `npm run test:live` reports an isolation violation, stop and report;
  - the conductor never calls an engine directly, only `AgentRunner`.
- **The project's checked-out branch is never touched.** Ark only runs `git worktree add -b`, plus `add`, `commit`, `diff`, `log` and `rev-parse` inside the worktree. It never runs `checkout`, `switch`, `reset`, `push` or `merge`.
- `npm test` never calls a model. Git tests use real `git` in temp folders. They set `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` in `process.env` for the test file. Production uses the user's Git identity.
- **Limits, copied from the spec or decided above:**
  - `REVIEW_ROUNDS = 2` (§8.3);
  - checks are `['typecheck', 'lint', 'test', 'build']`;
  - `DIFF_MAX = 100_000` characters sent to a reviewer;
  - `CHECK_MS = 600_000` per script;
  - `CHECK_TAIL = 4_000` characters of output per failed script.
- UI copy in English. Accent `#00A896` only on Allow and on Start developer (spec §10). The brand rules are in `brand-guidelines.md`, and the Tailwind theme only has the brand's tokens (see `docs/handoff/2026-11-05-ark-ui-chat-redo.md`, "Da sapere").
- Commit with `git commit -F <file>`, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The project has uncommitted changes when the user clicks Start developer.** The worktree starts from HEAD, so they are not in it. The user expects to be told. → Task 6: the build-start note names the base commit and says uncommitted changes are not included.
2. **The project is not a Git repo, or has no commit yet.** The user expects a clear error, with the thread still in planning and the button still there. → Task 6 test.
3. **The plan's phase headings are in Italian or use a dash** (`## Fase 2 — API`). The user expects the phases to be found. → Task 3 test.
4. **An approval is answered after its turn ended** (pause, crash, timeout). The user expects "This request is no longer pending", not a crash or a stuck card. → Task 6 test.
5. **The phase diff is huge** (a lockfile, generated files). The user expects the review to still run, on a truncated diff, with the reviewer told to read the files. → Task 3 test (`NOTES.review` truncation) and Task 6 (the conductor passes `truncated`).

---

### Task 1: Workspace — Git and checks in a worktree

**Files:**
- Create: `src/main/services/threads/workspace.ts`
- Test: `tests/main/workspace.test.ts`

**Interfaces:**
- Produces:
  - `type CheckResult = { script: string; ok: boolean; tail: string }`
  - `const CHECK_SCRIPTS = ['typecheck', 'lint', 'test', 'build'] as const`
  - `const workspace = { head, addWorktree, commitAll, diff, log, projectChecks, runChecks }`, typed as `type Workspace = typeof workspace`:
    - `head(dir: string): Promise<string | undefined>`: the HEAD sha, or `undefined` when the repo has no commit or is not a repo;
    - `addWorktree(repo: string, path: string, branch: string): Promise<void>`: `git -C repo worktree add -b <branch> <path> HEAD`. It throws `Error(<git stderr, trimmed>)` on failure;
    - `commitAll(dir: string, message: string): Promise<string | undefined>`: `add -A`, and when `status --porcelain` is not empty, `commit -m`. Returns the new sha, or `undefined` when there was nothing to commit. It throws on a git failure;
    - `diff(dir: string, base: string): Promise<string>`: `git diff <base> HEAD`;
    - `log(dir: string, base: string): Promise<string>`: `git log --oneline <base>..HEAD`;
    - `projectChecks(dir: string): string[]`: the `CHECK_SCRIPTS` present in `<dir>/package.json` `scripts`, in `CHECK_SCRIPTS` order. A missing or broken file gives `[]`;
    - `runChecks(dir: string, scripts: string[], timeoutMs = CHECK_MS): Promise<CheckResult[]>`: `npm run <script>` one at a time, all of them even after a failure. `tail` is the last `CHECK_TAIL` characters of stdout and stderr together, and `''` when `ok`.
  - `branchName(title: string, threadId: string): string`: `ark/${agentId(title).slice(0, 40)}-${threadId.slice(0, 8)}`, with any dash left trailing after the cut removed.

- [ ] **Step 1: Write the failing tests**

```ts
// beforeAll: set GIT_AUTHOR_NAME/EMAIL and GIT_COMMITTER_NAME/EMAIL; each test gets mkdtemp repo with one commit (README.md)
test('head is undefined for a repo with no commit and for a plain folder')
test('addWorktree creates the branch in a new folder and leaves the repo on its own branch', async () => {
  await workspace.addWorktree(repo, wt, 'ark/demo-1234abcd');
  expect(existsSync(join(wt, 'README.md'))).toBe(true);
  expect(await git(repo, 'branch', '--show-current')).toBe(mainBranch); // unchanged
  expect(await git(wt, 'branch', '--show-current')).toBe('ark/demo-1234abcd');
});
test('addWorktree throws git stderr when the branch exists')  // toThrow(/already exists/)
test('commitAll commits new and changed files, and returns undefined when clean', async () => {
  writeFileSync(join(wt, 'new.txt'), 'x');
  const sha = await workspace.commitAll(wt, 'ark: phase 1 — demo');
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  expect(await workspace.commitAll(wt, 'again')).toBeUndefined();
  expect(await workspace.diff(wt, base)).toContain('+x');
  expect(await workspace.log(wt, base)).toContain('ark: phase 1 — demo');
});
test('projectChecks keeps the known scripts in order', () => {
  // package.json scripts: { build, dev, test, lint }
  expect(workspace.projectChecks(dir)).toEqual(['lint', 'test', 'build']);
});
test('projectChecks is empty without package.json or with broken JSON')
test('runChecks runs every script and keeps the tail of a failure', async () => {
  // scripts: lint = node -e "console.log('fine')", test = node -e "console.error('boom'); process.exit(1)"
  const r = await workspace.runChecks(dir, ['lint', 'test']);
  expect(r.map((x) => [x.script, x.ok])).toEqual([['lint', true], ['test', false]]);
  expect(r[1].tail).toContain('boom');
  expect(r[0].tail).toBe('');
});
test('branchName slugs the title and keeps the id prefix', () => {
  expect(branchName('Add login page!', '1234abcd-0000-0000-0000-000000000000')).toBe('ark/add-login-page-1234abcd');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/workspace.test.ts`
Expected: FAIL, because `workspace.ts` does not exist.

- [ ] **Step 3: Implement `workspace.ts`**

Use one private `git(dir, args, timeoutMs = 60_000)` built on `execFile('git', ['-C', dir, ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })`. It resolves `{ ok, stdout, stderr }` and never rejects. `exec.ts`'s `run()` has no stderr and no `maxBuffer`, so it does not fit here. `runChecks` uses `execFile('npm', ['run', script], { cwd: dir, shell: true, timeout, windowsHide: true, maxBuffer: 64 MiB })`, because npm is a `.cmd` on Windows and needs the shell. The script names come from `CHECK_SCRIPTS`, never from user text, so the shell sees no outside input.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/main/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/threads/workspace.ts tests/main/workspace.test.ts
git commit -F .tmp/msg.txt   # feat: worktree git and project checks
```

---

### Task 2: Shared build types

**Files:**
- Modify: `src/shared/thread.ts`
- Test: none (types only; Tasks 3–6 use them)

**Interfaces:**
- Produces (exact names; later tasks rely on them):

```ts
export const REVIEW_ROUNDS = 2;
export const BUILD_TURN_MS = 3_600_000; // developer turns, approvals included
export const BUILD_ROLES = ['developer', 'code-reviewer', 'security-reviewer'] as const;
export const [DEVELOPER, CODE_REVIEWER, SECURITY_REVIEWER] = BUILD_ROLES;
export type PhaseStep = 'develop' | 'review' | 'security' | 'blocked' | 'done';
export type BuildPhase = {
  title: string; text: string; step: PhaseStep;
  base?: string;      // commit the phase started from (set when it starts)
  commit?: string;    // last commit Ark made for it
  rounds: number;     // times the developer was sent back (checks or reviews)
  notes: number;      // review findings so far, all rounds
  open: number;       // findings in the current review round
  checks?: string[];  // scripts that passed at the last run; [] = no checks found; undefined = not run yet
};
export type Build = { worktree: string; branch: string; plan: string; phases: BuildPhase[]; current: number };
```

Also:
- `Control` gets `| { kind: 'review'; pass: boolean; findings: string[] }`.
- `ThreadMessage` gets:
  - `| { kind: 'phase'; index: number }`: shown as the phase card;
  - `| { kind: 'approval'; agent: string; tool: string; detail: string }`;
  - `| { kind: 'decision'; target: number; allow: boolean }`: the answer to an approval, hidden like a reaction.
- `Thread` gets `build?: Build; approvals?: number[]`, the second being the seqs of approval messages still waiting.

- [ ] **Step 1: Add the types above to `src/shared/thread.ts`**
- [ ] **Step 2: Run `npm run typecheck`**

Expected: errors only where a `switch`/`if` over `ThreadMessage['kind']` must now handle the new kinds (`formatForAgent` in `protocol.ts`, `startsGroup` in `thread-view.ts`, the renderer list). Fix each one minimally: `formatForAgent` skips `phase`/`approval`/`decision`; `startsGroup` treats them like notes; the renderer skips them for now, and Task 9 draws them. Run it again: PASS.

- [ ] **Step 3: Run `npm test`**

Expected: PASS (nothing changed in behavior).

- [ ] **Step 4: Commit** (`feat: build state, phase/approval messages, review control`)

---

### Task 3: Protocol — build prompts, notes, review block, plan phases

**Files:**
- Modify: `src/main/services/threads/protocol.ts`
- Test: `tests/main/thread-protocol.test.ts`

**Interfaces:**
- Consumes: Task 2 types; `CheckResult` from Task 1.
- Produces:
  - `parsePhases(markdown: string): { title: string; text: string }[]`: a heading `^#{1,3}[ \t]+\S+[ \t]+\d+[ \t]*[:.\-–—][ \t]*(.+)$` (multiline) starts a phase. `text` runs from the heading to the next phase heading, heading included, trimmed.
  - `toControl` / `parseReply` accept `review`:
    - `{"review":"pass"}` → `{kind:'review', pass:true, findings:[]}`;
    - `{"review":"changes","findings":[…]}` → `pass:false`, with 1–20 findings, each a non-empty string of at most 2000 characters;
    - other shapes → `ark block: review must be "pass", or "changes" with 1 to 20 findings`.

    `kinds` becomes `['team', 'next', 'ask', 'plan', 'review']`, and the "use exactly one of" message lists all five.
  - `withProtocol(agent: AgentDef, phase: Phase = 'planning'): AgentDef`. In `build`:
    - `developer` gets `DEVELOPER_PROTOCOL`;
    - `code-reviewer` and `security-reviewer` get `REVIEWER_PROTOCOL`;
    - the manager keeps `MANAGER_PROTOCOL`, because its session started in planning.

    In any other phase, the behavior stays as today.
  - `MEMBER_PROTOCOL`'s plan line also says: `Start each phase with a heading "## Phase <n>: <title>".`
  - `formatForAgent` adds the review findings after a reviewer's text: `\n(findings:\n- a\n- b)` for `pass:false`, and `\n(review: pass)` for `pass:true`.
  - New entries in `NOTES` (exact names; the wording is free, but must say what is listed here):
    - `develop(o: { plan: string; index: number; total: number; phase: string; done: string[]; branch: string; worktree: string; deps: boolean })`: says you are starting phase `index+1`/`total` and gives the plan file path, the phase text, one line per earlier phase (`done`) and the branch. It says not to commit because Ark commits, and to run the checks before finishing. When `deps` is true it also says that `node_modules` is missing and to run `npm ci` first.
    - `checksFailed(results: CheckResult[])`: names each failed script and adds its `tail`.
    - `fix: 'The reviewers asked for changes (their findings are above). Fix them; Ark re-runs the checks and the reviews.'`
    - `userFix: 'The user replied (above). Continue the phase.'`
    - `review(o: { kind: 'code' | 'security'; phase: string; diff: string; worktree: string })`: holds the phase text and the diff. When `diff.length > DIFF_MAX`, it keeps the first `DIFF_MAX` characters and adds `The diff was cut at 100000 characters: read the changed files in <worktree>.` An empty diff becomes `(no changes in this phase)`.
    - `blocked(o: { phase: string; points: string[] })`: says the phase is blocked after 2 rounds, lists the open points, and asks the manager to ask the user how to continue with one `ask` block.
    - `summary(o: { branch: string; phases: { title: string; notes: number; commit?: string }[]; tokens: string[] })`: asks for a short summary for the user (what was built, the branch, the review notes, the tokens below), with no Ark block.
  - `DEVELOPER_PROTOCOL` and `REVIEWER_PROTOCOL` (exact content up to the implementer):
    - developer: you work alone in the worktree, Ark relays reviewer findings and user replies, and no Ark block is needed;
    - reviewer: you review one phase's diff, read-only, and must end with exactly one `review` block (both shapes shown).

- [ ] **Step 1: Write the failing tests**

```ts
test('parsePhases finds Phase, Fase and dash headings', () => {
  const md = '# Plan\nintro\n## Phase 1: Setup\na\n### Fase 2 — API\nb\n## Notes\nc';
  expect(parsePhases(md)).toEqual([
    { title: 'Setup', text: '## Phase 1: Setup\na' },
    { title: 'API', text: '### Fase 2 — API\nb\n## Notes\nc' },
  ]);
});
test('parsePhases is empty for a plan without numbered headings')
test('parseReply reads a review pass and a review with findings', () => {
  expect(parseReply(ark({ review: 'pass' })).control).toEqual({ kind: 'review', pass: true, findings: [] });
  expect(parseReply(ark({ review: 'changes', findings: ['null check'] })).control).toEqual({ kind: 'review', pass: false, findings: ['null check'] });
});
test('parseReply rejects changes without findings', () => {
  expect(parseReply(ark({ review: 'changes', findings: [] })).error).toMatch(/1 to 20 findings/);
});
test('withProtocol gives build roles their build prompt only in the build phase')
test('formatForAgent shows a reviewer\'s findings')
test('NOTES.review cuts a long diff and points to the worktree', () => {
  const n = NOTES.review({ kind: 'code', phase: 'P', diff: 'x'.repeat(100_001), worktree: 'W' });
  expect(n).toContain('x'.repeat(100_000));
  expect(n).not.toContain('x'.repeat(100_001));
  expect(n).toContain('read the changed files in W');
});
test('NOTES.develop asks for npm ci only when node_modules is missing')
```

- [ ] **Step 2: Run them and see them fail** — `npx vitest run tests/main/thread-protocol.test.ts`
- [ ] **Step 3: Implement the interfaces above in `protocol.ts`**
- [ ] **Step 4: Run them and see them pass,** then run `npm test` (the existing protocol tests must still pass)
- [ ] **Step 5: Commit** (`feat: build protocol, review block, plan phases`)

---

### Task 4: Engines — the build permission profile and approvals

**Files:**
- Modify:
  - `src/shared/types.ts` (`ChatEvent`);
  - `src/main/services/engines/session.ts` (`EngineSession`);
  - `src/main/services/engines/isolation.ts` (`claudeArgs`);
  - `src/main/services/engines/claude-session.ts`;
  - `src/main/services/engines/app-server-client.ts`;
  - `src/main/services/engines/codex-session.ts`;
  - `src/main/services/agent-runner.ts`.
- Test:
  - `tests/main/isolation.test.ts`;
  - `tests/main/claude-session.test.ts`;
  - `tests/main/codex-session.test.ts`;
  - `tests/main/agent-runner.test.ts`.

**Interfaces:**
- Produces:
  - `ChatEvent` gets `| { type: 'approval'; id: string; tool: string; detail: string }`.
  - `EngineSession` gets `answer(id: string, allow: boolean): void`. It throws `Error('This request is no longer pending')` for an unknown or already answered id.
  - `claudeArgs(o: { model; roleFile; pluginDir; permissions: Permissions })`:
    - `read-only`: drop `--disallowedTools …` and add `--tools`, `Read,Glob,Grep,Skill`;
    - `build`: add `--tools`, `Read,Glob,Grep,Skill,Edit,Write,Bash,PowerShell`, `--permission-mode`, `acceptEdits`, `--permission-prompt-tool`, `stdio`.

    Every other flag stays as it is.
  - Claude session, once `checked` is set:
    - for `type:'control_request'` with `request.subtype === 'can_use_tool'`: keep `request.input` under `request_id`, then emit `{type:'approval', id: request_id, tool: request.display_name ?? request.tool_name, detail}`. `detail` is the first string found among `input.command`, `input.file_path`, `request.description`, else `JSON.stringify(input).slice(0, 500)`;
    - `answer(id, true)` writes the `allow` control_response with `updatedInput`, and `answer(id, false)` writes `deny` with `message: 'The user denied this in Ark.'` (shapes under "Verified");
    - any other `control_request` subtype gets `{"type":"control_response","response":{"subtype":"error","request_id":…,"error":"Not supported by Ark"}}`;
    - pending ids are dropped on `result`, on stop and on exit.

    Also, deferred from step 2: the `modelUsage` lookup matches `k === model || k.startsWith(model) || model.startsWith(k)` before falling back to the first entry.
  - `AppServerClient.onRequest(cb: (method: string, params: unknown, reply: (result: unknown) => void) => boolean)`. A server request goes to the callbacks in order, and the first that returns `true` owns it and calls `reply` later. When none claims it, the current `-32601` answer is sent. `reply` after `close()` does nothing.
  - `startCodexSession` gets `permissions: Permissions`:
    - `build` → `sandbox: 'workspace-write'`, `approvalPolicy: 'on-request'`, and claims `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`. It emits `{type:'approval', id: String(<rpc id>), tool: 'command' | 'file change', detail: command ?? reason ?? grantRoot ?? ''}`, and `answer` replies `{decision: allow ? 'accept' : 'decline'}`;
    - `read-only` → as today, and claims nothing.
  - `AgentRunner`:
    - passes `agent.permissions` to `claudeArgs` and `startCodex`;
    - gets `answer(chatId: string, id: string, allow: boolean): void`, which throws `Unknown chat` or passes the session's error through;
    - in `turn()`, an `approval` event is neither text nor an error. Only `type === 'error'` rejects.

- [ ] **Step 1: Write the failing tests**

```ts
// isolation.test.ts
test('claudeArgs whitelists read-only tools', () => {
  const a = claudeArgs({ model: 'haiku', roleFile: 'r', pluginDir: 'p', permissions: 'read-only' });
  expect(a.slice(a.indexOf('--tools'), a.indexOf('--tools') + 2)).toEqual(['--tools', 'Read,Glob,Grep,Skill']);
  expect(a).not.toContain('--disallowedTools');
  expect(a).not.toContain('--permission-prompt-tool');
});
test('claudeArgs gives build agents edits, shell and stdio prompts')   // asserts the three flag pairs
// claude-session.test.ts (fake spawn, as the existing tests)
test('a can_use_tool request becomes an approval event and allow answers with the input', () => {
  // init line, then {"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"npm ci"}}}
  expect(events).toContainEqual({ type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci' });
  s.answer('r1', true);
  expect(JSON.parse(lastStdinLine())).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: { command: 'npm ci' } } } });
  expect(() => s.answer('r1', false)).toThrow('This request is no longer pending');
});
test('deny answers with the Ark message')
test('a control_request before init is not forwarded')               // isolation stop, no approval event
test('an unknown control_request subtype is answered with an error')
test('contextWindow is found for a model id with a suffix')            // modelUsage key 'claude-opus-5-5[1m]', model 'claude-opus-5-5'
// codex-session.test.ts (fake app-server, as the existing tests)
test('a build session starts workspace-write on-request and turns command approvals into events', async () => {
  // assert thread/start params; server sends {id: 7, method: 'item/commandExecution/requestApproval', params: {command: 'curl x'}}
  expect(events).toContainEqual({ type: 'approval', id: '7', tool: 'command', detail: 'curl x' });
  s.answer('7', false);
  expect(sent).toContainEqual({ id: 7, result: { decision: 'decline' } });
});
test('a read-only session still answers approvals with -32601')
// agent-runner.test.ts
test('turn does not reject on an approval event and answer reaches the session')
test('a build agent gets the build claude args')
```

- [ ] **Step 2: Run them and see them fail** — `npx vitest run tests/main/isolation.test.ts tests/main/claude-session.test.ts tests/main/codex-session.test.ts tests/main/agent-runner.test.ts`
- [ ] **Step 3: Implement the interfaces above.** Fake sessions in the existing tests need an `answer` method, which can be a no-op.
- [ ] **Step 4: Run them and see them pass,** then `npm test` and `npm run typecheck`
- [ ] **Step 5: Commit** (`feat: build permission profile and approval routing on both engines`)

---

### Task 5: Build rules — the pure state machine

**Files:**
- Create: `src/main/services/threads/build-rules.ts`
- Test: `tests/main/build-rules.test.ts`

**Interfaces:**
- Consumes: Task 2 types; `CheckResult` (Task 1); `Control` with `review`.
- Produces:

```ts
export type BuildStep =
  | { do: 'develop' }                                        // fresh developer session, NOTES.develop
  | { do: 'fix'; why: 'checks' | 'review' | 'user'; results?: CheckResult[] }  // same developer session
  | { do: 'review'; who: 'code' | 'security'; retry?: string } // fresh reviewer session; retry = correction note
  | { do: 'escalate' }                                       // manager turn, NOTES.blocked
  | { do: 'summary' }                                        // manager turn, NOTES.summary
  | { do: 'wait'; note?: string }
  | { do: 'finish' };                                        // phase -> 'done', status idle
export type BuildDecision = { thread: Thread; step: BuildStep };
export function startBuild(t: Thread, build: Omit<Build, 'current' | 'phases'> & { phases: { title: string; text: string }[] }): BuildDecision;
export function afterChecks(t: Thread, results: CheckResult[]): BuildDecision;
export function afterReview(t: Thread, who: 'code' | 'security', control: Control | undefined, error?: string): BuildDecision;
export function afterBuildUser(t: Thread): BuildDecision;   // user message while the build is not running
export function afterManager(t: Thread): BuildDecision;     // the manager's escalate or summary reply
export function openPoints(messages: ThreadMessage[], since: number): string[]; // review findings in messages with seq > since
```

The rules, all on `t.build.phases[t.build.current]` (call it `p`):
- **`startBuild`:** `phase: 'build'`, `retried: false`, and `build` with each phase as `{ step: 'develop', rounds: 0, notes: 0, open: 0 }` and `current: 0`. Step `develop`.
- **`afterChecks`:**
  - every result ok → `p.checks = <scripts>`, `p.step = 'review'`, step `review code`;
  - any failure → `fail('checks', results)`.
- **`afterReview`:**
  - bad (an `error`, or a control that is not `review`): when `!t.retried`, set `retried: true` and return step `review` with the same `who` and `retry: NOTES.invalid(error ?? 'missing review block')`. When `t.retried` is already set, clear it and return `wait` with the note `<Code|Security> reviewer did not give a valid review. Reply to continue.`;
  - `who === 'code'` → `p.open = findings.length`, `p.notes += findings.length`, `p.step = 'security'`, step `review security`;
  - `who === 'security'` → `p.open += findings.length`, `p.notes += findings.length`. If `p.open === 0`, the phase passes: `p.step = 'done'`, and either `current + 1` with step `develop`, or, after the last phase, step `summary`. Otherwise `fail('review')`.
  - Every valid review sets `retried: false`.
- **`fail(why, results?)`** (private): when `p.rounds >= REVIEW_ROUNDS` → `p.step = 'blocked'`, step `escalate`. Otherwise → `p.rounds += 1`, `p.step = 'develop'`, step `fix` with `why` (and `results`).
- **`afterManager`:**
  - `p.step === 'blocked'` → `wait`;
  - all phases `done` → `finish`, with `phase: 'done'`;
  - otherwise → `wait`.
- **`afterBuildUser`:**
  - `blocked` → `p.rounds = 0`, `p.step = 'develop'`, step `fix user`;
  - `develop` → step `fix user` (the conductor starts a fresh session when none is alive);
  - `review` → step `review code`;
  - `security` → step `review security`;
  - all phases done but the thread not `done` → step `summary`;
  - thread `done` → `wait`.

- [ ] **Step 1: Write the failing tests**

```ts
const results = (ok: boolean) => [{ script: 'test', ok, tail: ok ? '' : 'boom' }];
const pass = { kind: 'review', pass: true, findings: [] } as const;
const changes = { kind: 'review', pass: false, findings: ['a', 'b'] } as const;
test('startBuild opens phase 1 in develop')
test('green checks go to the code review, red checks back to the developer', () => {
  expect(afterChecks(t, results(true)).step).toEqual({ do: 'review', who: 'code' });
  const d = afterChecks(t, results(false));
  expect(d.step).toEqual({ do: 'fix', why: 'checks', results: results(false) });
  expect(d.thread.build!.phases[0].rounds).toBe(1);
});
test('both reviews run before the developer gets findings', () => {
  let d = afterReview(inReview, 'code', changes);
  expect(d.step).toEqual({ do: 'review', who: 'security' });
  d = afterReview(d.thread, 'security', pass);
  expect(d.step).toEqual({ do: 'fix', why: 'review' });
  expect(d.thread.build!.phases[0].notes).toBe(2);
});
test('two passes finish the phase and open the next one in develop')
test('the last phase passing asks for the summary')
test('a third failure after two rounds blocks the phase and escalates', () => {
  const p = { ...phase, rounds: REVIEW_ROUNDS, step: 'security', open: 1 };
  const d = afterReview(withPhase(p), 'security', pass);
  expect(d.step).toEqual({ do: 'escalate' });
  expect(d.thread.build!.phases[0].step).toBe('blocked');
});
test('a bad review block gets one correction, then the thread waits')
test('the user unblocks a phase with rounds reset')
test('afterBuildUser resumes the step the phase was in')
test('afterManager finishes the thread only when every phase is done')
test('openPoints lists the findings of reviews after a seq')
```

- [ ] **Step 2: Run them and see them fail** — `npx vitest run tests/main/build-rules.test.ts`
- [ ] **Step 3: Implement `build-rules.ts`.** It is pure: no I/O, and it never mutates its input, so copy `build`, `phases` and `p`.
- [ ] **Step 4: Run them and see them pass**
- [ ] **Step 5: Commit** (`feat: build rules state machine`)

---

### Task 6: Conductor — start the build, run the loop, route approvals

**Files:**
- Modify: `src/main/services/threads/conductor.ts`, `src/main/services/threads/store.ts` (`recover`)
- Test: `tests/main/conductor.test.ts`, `tests/main/thread-store.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `ConductorDeps` gets:
    - `workspace: Workspace`;
    - `worktrees: string` (root folder);
    - `runner: Pick<AgentRunner, 'startAgent' | 'turn' | 'stop' | 'answer' | 'onEvent'>`.
  - `async startDeveloper(threadId: string): Promise<void>`, which replaces the step-2 placeholder.
  - `answer(threadId: string, seq: number, allow: boolean): void`.
  - The constructor subscribes to `runner.onEvent` for `approval` events.

**Behavior:**

1. **`startDeveloper`.** Runs the checks below in order, and on the first failure throws the error shown, leaving the thread unchanged:
   1. the same phase and plan-card check as today;
   2. a second call while one is still in flight is rejected with `The developer is already starting`;
   3. the project is a Git repo with a commit: `head(project.dir)`, else `The project needs a Git repository with at least one commit`;
   4. each of `BUILD_ROLES` is in the catalog, else `Add a <role> agent (id <role>) to the catalog`;
   5. `catalog.get(DEVELOPER).permissions === 'build'`, else `The developer agent needs permissions: build`;
   6. `parsePhases(<plan text>)` is not empty, else `The plan has no phases`.

   Then:
   1. `halt(t)`;
   2. `addWorktree(project.dir, join(worktrees, id.slice(0, 8)), branchName(t.title, id))`;
   3. write the plan to `<worktree>/docs/plans/<YYYY-MM-DD>-<slug>.md`, then `commitAll(worktree, 'docs: plan for <title>')`, which gives the phase-1 base;
   4. add the missing roles to `team`;
   5. append the note `Building on branch <branch> from <base sha, 7 chars>. Uncommitted changes in the project are not included. Added to the team: <names>.` The last sentence appears only when roles were added;
   6. apply `startBuild` and start the loop.
2. **The loop** (`runBuild(t, step, gen)`). It uses the same generation, `live()` and error-note pattern as `run()`. Factor the session-and-turn part of `run()` into a private helper that both use, instead of copying it. Each step:
   - **`develop`**:
     - set `p.base`, which is HEAD at the time the phase starts. Phase 1 uses the plan commit;
     - append `{kind:'phase', index}`;
     - stop the developer's old session and start a fresh one, with `withProtocol(def, 'build')` and cwd = worktree;
     - send only `NOTES.develop(...)` with `deps = !existsSync(join(worktree, 'node_modules')) && existsSync(join(worktree, 'package.json'))`, with timeout `BUILD_TURN_MS`;
     - then do the after-turn steps below.
   - **`fix`**: the same developer session, or a fresh one with `NOTES.develop` first when none is alive. The input is the unseen transcript (as `run()` builds it today), plus `NOTES.checksFailed(results)`, `NOTES.fix` or `NOTES.userFix`. Timeout `BUILD_TURN_MS`. Then the after-turn steps.
   - **After every developer turn:**
     - append the reply;
     - `commitAll(worktree, 'ark: phase <n> — <title>')`, and set `p.commit` when it returns a sha;
     - `runChecks(worktree, projectChecks(worktree))`;
     - append the note `Checks passed: <list>.`, `Checks failed: <list>.` or `No checks found in package.json.`;
     - `afterChecks`.
   - **`review`**:
     - start a fresh reviewer session (cwd = worktree);
     - send `NOTES.review({ kind, phase: p.text, diff: await diff(worktree, p.base), worktree })`, plus the `retry` note when there is one;
     - append the reply;
     - stop the session;
     - `afterReview(t, who, control, error)`.
   - **`escalate`**: a manager turn (its live session, cwd = project dir) with `NOTES.blocked({ phase: p.title, points: openPoints(messages, <seq of this phase's card>) })`, or with the failed check names when the phase blocked on checks. Then `afterManager`. The thread waits with `waitingOn: MANAGER`.
   - **`summary`**: a manager turn with `NOTES.summary(...)`, where each `tokens` line is `<agent name>: <input> in / <output> out`, from `tokensByAgent`. Then `afterManager`, which gives `finish`.
   - **`wait` / `finish`**: save with `status: 'waiting'` (or `idle` for `finish`) and `speaking: undefined`.
3. **`send` during the build:**
   - while `status === 'running'`, only append the message, with no interrupt; the developer reads it on its next turn;
   - otherwise apply `afterBuildUser`;
   - planning and team behavior stay unchanged.
4. **Approvals:**
   - on a runner `approval` event, find the thread and agent that own the `chatId` in `sessions`, and ignore it when none does;
   - append `{kind:'approval', agent, tool, detail}`, keep `seq → { chatId, id }` in memory, and save with `approvals: [...(t.approvals ?? []), seq]`;
   - **`answer(threadId, seq, allow)`**: throws `This request is no longer pending` when `seq` is not in `t.approvals` or in memory. Otherwise it calls `runner.answer`, appends `{kind:'decision', target: seq, allow}` and removes `seq` from `approvals`;
   - when a turn ends (in any way), and in `halt`, `pause` and `stopAll`, drop that chat's pending approvals from memory and from `approvals`.
5. **`ThreadStore.recover()`** also clears `approvals`.

- [ ] **Step 1: Write the failing tests** (the fake runner gets `answer` and `onEvent`/`emit`; a fake `workspace` records calls and returns queued results)

```ts
test('startDeveloper refuses a project without a commit and leaves the thread in planning', async () => {
  ws.headResult = undefined;
  await expect(c.startDeveloper(id)).rejects.toThrow('The project needs a Git repository with at least one commit');
  expect(store.get(id)!.phase).toBe('planning');
});
test('startDeveloper creates the worktree, commits the plan, adds missing roles and starts phase 1', async () => {
  await c.startDeveloper(id);
  expect(ws.calls[0]).toEqual(['addWorktree', projectDir, join(worktrees, id.slice(0, 8)), expect.stringMatching(/^ark\//)]);
  expect(store.messages(id).some((m) => m.kind === 'note' && /Uncommitted changes in the project are not included/.test(m.text))).toBe(true);
  expect(store.get(id)!.team).toEqual(expect.arrayContaining(['developer', 'code-reviewer', 'security-reviewer']));
  expect(runner.started.at(-1)!.id).toBe('developer');
});
test('a phase runs develop, checks, code review, security review, then the summary')
test('red checks send the developer back in the same session with the failure tail')
test('review findings reach the developer after both reviews, in its next turn')
test('two rounds without agreement give the manager a blocked note and the thread waits')
test('the user reply unblocks the phase')
test('reviewer sessions are stopped after their reply; the developer session at phase end')
test('an approval event adds a card and answer reaches the runner', async () => {
  runner.emit(devChat, { type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci' });
  const card = store.messages(id).findLast((m) => m.kind === 'approval')!;
  expect(store.get(id)!.approvals).toEqual([card.seq]);
  c.answer(id, card.seq, true);
  expect(runner.answers).toEqual([[devChat, 'r1', true]]);
  expect(store.get(id)!.approvals).toEqual([]);
});
test('answering after the turn ended throws "This request is no longer pending"')
test('pause drops pending approvals')
test('a message during a running build turn does not redirect the turn')
// thread-store.test.ts
test('recover clears pending approvals')
```

- [ ] **Step 2: Run them and see them fail** — `npx vitest run tests/main/conductor.test.ts tests/main/thread-store.test.ts`
- [ ] **Step 3: Implement the behavior above**
- [ ] **Step 4: Run them and see them pass,** then `npm test` (the step-2 conductor tests must still pass) and `npm run typecheck`
- [ ] **Step 5: Commit** (`feat: build loop, worktree start and approvals in the conductor`)

---

### Task 7: Wiring — main, IPC, preload, API types

**Files:**
- Modify:
  - `src/main/index.ts`: pass `workspace` and `worktrees: join(userData, 'worktrees')` to the `Conductor`;
  - `src/main/ipc/index.ts`: `threads:start-developer` awaits, and the new `threads:answer`;
  - `src/preload/index.ts`;
  - `src/shared/types.ts`: `ArkApi.threads.answer(id: string, seq: number, allow: boolean): Promise<void>`.
- Test: none new. The validators are the existing `uuid` and `seq`, plus `allow`, which must be `typeof === 'boolean'`, else `Invalid answer`. The handler is one line.

- [ ] **Step 1: Add `threads:answer`**, as `handle('threads:answer', (id, n, allow) => conductor.answer(uuid(id, 'thread'), seq(n), bool(allow)))` with a local `bool`
- [ ] **Step 2: Expose it in the preload and in `ArkApi`.** Make `threads:start-developer` return the promise.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 4: Commit** (`feat: wire the build phase and approvals through IPC`)

---

### Task 8: Live tests — approvals on real engines

**Files:**
- Modify: `tests/live/engines.live.test.ts` (or add `tests/live/build.live.test.ts`, following the existing live-test setup)
- Modify: `README.md` (the `Threads` section: build phase, approvals, branch and worktree, `npm ci` on first use)

**Interfaces:**
- Consumes: `AgentRunner` as wired in the existing live tests, with an agent of `permissions: 'build'` and `tier: 'light'`, and a temp Git repo with one commit as the project.

- [ ] **Step 1: Write the live tests**
  - **Claude, build agent:**
    - the existing isolation assertion passes, so the skills are still loaded with `--tools`;
    - a prompt asking to run `npm install left-pad` gives an `approval` event whose detail contains `left-pad`;
    - `answer(id, false)` lets the turn end with no `node_modules` in the repo;
    - a second prompt asks to run a command that prompts, for example `npm view left-pad version`. `answer(id, true)` makes the command run, which confirms the `allow` shape. If no prompt comes, the test logs it and the allow shape stays unconfirmed: report it, do not loosen anything;
    - the `turn` result has `contextUsed` defined, which closes the deferred "contextUsed not proven on a real stream".
  - **Claude, read-only agent:** the existing tests still pass with `--tools Read,Glob,Grep,Skill`.
  - **Codex, build agent:** a prompt asking to run `curl https://example.com` with escalated permissions gives an `approval` event (tool `command`), and `answer(id, false)` ends the turn. If the model never asks, the test fails with a clear message. Report it before touching the policy.
- [ ] **Step 2: Run** `npm run test:live`. Expected: PASS, with no isolation violation and no orphan `claude`/`codex` process after it (`Get-Process claude,codex` is empty).
- [ ] **Step 3: Update the `README.md` Threads section**
- [ ] **Step 4: Commit** (`test: live approval round trips on both engines`)

---

### Task 9: Renderer — phase cards, approval cards, badge

**Files:**
- Modify:
  - `src/shared/thread-view.ts`: `needsYou(t: Thread): boolean` and `decisionsOf(messages): Map<number, boolean>`;
  - `src/renderer/components/Cards.tsx`: `PhaseCard`, `ApprovalCard`;
  - `src/renderer/components/ThreadView.tsx`: draws `phase` and `approval`, hides `decision`;
  - `src/renderer/App.tsx` and `src/renderer/pages/Threads.tsx`: the badge uses `needsYou`.
- Test: `tests/shared/thread-view.test.ts`

**Interfaces:**
- Produces:
  - `needsYou(t) = t.status === 'waiting' || (t.approvals?.length ?? 0) > 0`;
  - `decisionsOf` maps an approval seq to `allow`, and the last decision wins.

**Cards:**
- **`PhaseCard({ phase: BuildPhase; index: number; total: number })`:**
  - title `🧱 Phase <n>/<total> · <title>`;
  - a state label: `develop` → In progress, `review` / `security` → In review, `blocked` → Blocked, `done` → Done;
  - four lines, each `✓` when passed, `…` when current, `·` when not reached yet:
    - development;
    - `review (<notes> notes)`;
    - security;
    - `checks: <list>`, or `no checks` when `checks` is `[]`.
- **`ApprovalCard({ m, pending, decision, busy, answer })`:**
  - `🔐 <agent name> wants to use <tool>`, with `detail` in a monospace block;
  - while pending: `Allow` (CTA) and `Deny` (BUTTON_INSET);
  - otherwise `✅ Allowed`, `🚫 Denied` or `Expired`.
- The phase card reads the live `thread.build.phases[index]`, so it updates without a new message.

- [ ] **Step 1: Write the failing tests** for `needsYou` (waiting, approvals pending, neither) and `decisionsOf` (last wins)
- [ ] **Step 2: Run them and see them fail** — `npx vitest run tests/shared/thread-view.test.ts`
- [ ] **Step 3: Implement the helpers and the cards.** Wire `answer` through the existing `run()` in `ThreadView`, so the buttons wait on `inflight`.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Look at it.** Build, then start on a separate profile as described in `docs/handoff/2026-11-05-ark-ui-chat-redo.md` ("Da sapere"; never use `%APPDATA%\ark`). Use a fake thread in phase `build` with two phases (one `done`, one `review`), a pending approval and a `decision`. Check the cards with a CDP screenshot, and check that the sidebar shows ✋ for the thread with the approval.
- [ ] **Step 6: Commit** (`feat: phase and approval cards`)

---

### Task 10: Manual check in dev (the user)

This needs real agents and the native folder picker, so it is up to the user. Write it into the handoff, do not run it.

1. On a small throwaway repo with a `package.json` that has a `test` script: plan a two-phase change → **Start developer**.
2. Check the note (branch, base, uncommitted changes), the phase card, the `npm ci` approval card → Allow.
3. Let one phase run through development → checks → code review → security review → done, then the second, then the manager's summary. The thread is `done`.
4. In the project: `git branch --show-current` is unchanged, `git log ark/<…>` shows the plan commit and the phase commits, and the worktree is under `%APPDATA%\ark\worktrees\`.
5. Pause during a developer turn, send a message, and check that the build resumes.
6. After quitting, `Get-Process claude,codex` is empty.
