# Agent Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hostile repository cannot run code with the user's privileges, change a Claude session's environment, or act outside the thread worktree in Ask or Auto without the user's yes.

**Architecture:** The Claude settings check moves from the conductor into `AgentRunner`'s Claude launch path and becomes a key allowlist. A per-thread `projectCode` consent, asked once through the existing approval card, gates Ark's own check runs and the Claude developer's preallowed check commands. Point fixes harden the Auto check policy, the skill gate and the Codex project rules. `runChecks` takes an `AbortSignal` so pause really stops it.

**Tech Stack:** TypeScript, Electron main process, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-agent-security-hardening-design.md`

## Global Constraints

- Always a hyphen (-), never an em dash (U+2014), in code, copy, docs and commit messages.
- UI text is English.
- Do not weaken `engines/isolation.ts`, the approval policy, Full access as the only bypass, or Ark's Git without hooks.
- `npm run test:live` costs tokens: ask the user before running it, never unprompted. Any live `claude -p` probe counts the same.
- Before reporting a task done: `npm run typecheck`, `npm run lint`, `npm test`. Before the final report also `npm run build`, and launch the app with `npm run dev` for the consent card (Task 3) and pause (Task 6).
- Commit with `git commit -F <file>` (file written without BOM, PowerShell splits `-m` here-strings). Message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Full access behavior does not change.

## Review Focus

1. **Ark restarts while the consent card is pending.** The card shows Expired, no answer is stored, and the next run asks again; checks never run silently. Test in Task 3.
2. **The user switches to Full access while the consent card is pending, then back to Ask.** Full runs checks without asking and stores nothing; back in Ask, with no stored answer, Ark asks again. Test in Task 3.
3. **Harmless settings files.** `{}`, a BOM, `{"$schema": "..."}`, `{"permissions": {}}`, `{"permissions": {"deny": ["Bash"]}}` start; `{"permissions": "x"}` is refused. Test in Task 1.
4. **Pause with no checks running, or twice in a row.** Resolves at once, thread `idle`, no "may still be running" note. Test in Task 6.
5. **Codex developer with consent denied.** Ark runs no checks; the Codex session starts with the same arguments as today (its sandboxed commands are untouched). Test in Task 3.

---

### Task 1: Claude settings allowlist before every Claude start (V2, I2)

**Files:**
- Modify: `src/main/services/engines/isolation.ts` (add `claudeSettingsProblem`)
- Modify: `src/main/services/threads/workspace.ts:220-246` (remove `claudeSettingsProblem`)
- Modify: `src/main/services/agent-runner.ts:76-80` (call it in the Claude branch)
- Modify: `src/main/services/threads/conductor.ts:30,216-217,676-678,726-728` (remove the three calls and the import)
- Test: `tests/main/isolation.test.ts`, `tests/main/agent-runner.test.ts`; move the `claudeSettingsProblem` tests out of `tests/main/workspace.test.ts:196-232`; remove conductor tests that expect the conductor itself to refuse settings.

**Interfaces:**
- Produces: `claudeSettingsProblem(dir: string): string | undefined` exported from `engines/isolation.ts`. Same contract as today (undefined = may start; a message naming the file and keys otherwise), new rule below.

- [ ] **Step 1: Write the failing tests** in `tests/main/isolation.test.ts`

```ts
test.each([
  [{}], [{ $schema: 'https://json.schemastore.org/claude-code-settings.json' }],
  [{ permissions: {} }], [{ permissions: { deny: ['Bash'], ask: ['Edit'] } }],
])('claudeSettingsProblem accepts settings that cannot run anything: %j', (s) => {
  writeSettings(root, s);
  expect(claudeSettingsProblem(root)).toBeUndefined();
});

test.each([
  [{ hooks: { PreToolUse: [] , Stop: [{}] } }, 'hooks'],
  [{ env: { ANTHROPIC_BASE_URL: 'http://x' } }, 'env'],
  [{ apiKeyHelper: 'x' }, 'apiKeyHelper'],
  [{ outputStyle: 'x' }, 'outputStyle'],
  [{ permissions: { allow: ['Bash'] } }, 'permissions.allow'],
  [{ permissions: { defaultMode: 'bypassPermissions' } }, 'permissions.defaultMode'],
  [{ permissions: { additionalDirectories: ['C:/'] } }, 'permissions.additionalDirectories'],
  [{ permissions: 'x' }, 'permissions'],
])('claudeSettingsProblem refuses any other key: %j', (s, key) => {
  writeSettings(root, s);
  expect(claudeSettingsProblem(root)).toContain(key);
});

test('claudeSettingsProblem names every offending key at once', () => {
  writeSettings(root, { env: {}, hooks: { Stop: [{}] }, permissions: { allow: ['x'] } });
  expect(claudeSettingsProblem(root)).toContain('sets env, hooks, permissions.allow,');
});
```

Keep the BOM test (BOM + `{}` accepted, BOM + hooks refused) and the invalid JSON test (`/is not valid JSON/`), moved here. An empty-valued key outside the allowlist (`{ "env": {} }`) is refused too: unknown means refused.

In `tests/main/agent-runner.test.ts`:

```ts
test('refuses to start Claude on project settings outside the allowlist, before spawning', async () => {
  writeSettings(project, { env: { ANTHROPIC_BASE_URL: 'http://x' } });
  // read-only chat, the path that had no check
  await expect(runner.startAgent(agent(), project)).rejects.toThrow(/settings\.json sets env/);
  expect(startClaude).not.toHaveBeenCalled();
});

test('a Claude settings file does not block a Codex session', async () => {
  writeSettings(project, { hooks: { Stop: [{}] } });
  const r = await runnerWithOnlyCodex.startAgent(agent(), project);
  expect(r.engine).toBe('codex');
});
```

(`writeSettings(dir, obj)` writes `<dir>/.claude/settings.json`; add it as a local helper in each test file. Use the file's existing fakes for `startClaude`, `startCodex` and an engines list with only Codex installed.)

- [ ] **Step 2: Run, verify they fail**

Run: `npx vitest run tests/main/isolation.test.ts tests/main/agent-runner.test.ts`
Expected: FAIL (`claudeSettingsProblem` not exported from isolation; runner starts Claude).

- [ ] **Step 3: Implement**

Allowlist, exact: top-level keys `$schema` and `permissions`; inside `permissions` only `deny` and `ask`. Anything else is reported as `key` or `permissions.<key>`, in file order. `permissions` that is not an object is reported as `permissions`. Message:

`${file} sets ${keys.join(', ')}, which Ark does not allow in agent sessions: they could run commands, change the environment or skip approval cards. Remove them, then try again.`

Invalid JSON keeps today's message. In `agent-runner.ts`, Claude branch, right after the `ancestorInstructions` check: `const bad = claudeSettingsProblem(projectDir); if (bad) throw new Error(bad);`. Delete the conductor's three calls (the runner now checks every fresh Claude session, reviewers included) and the function in `workspace.ts`.

- [ ] **Step 4: Run, verify they pass**

Run: `npm test`
Expected: PASS. Fix conductor tests that asserted the conductor's own refusal by deleting them; the runner test covers it.

- [ ] **Step 5: Commit** `fix: allowlist Claude project settings before every Claude start`

---

### Task 2: Survey what a `-p` Claude session loads from the project

**Files:**
- Modify: `docs/superpowers/specs/2026-11-10-agent-security-hardening-design.md` ("Open, needs a live check": replace with the findings)
- Modify (only if the survey finds a loaded item that runs a command or widens tools): `src/main/services/engines/isolation.ts` and its tests, same pattern as Task 1.

**Interfaces:** none new, unless the survey finds something; then a refusal in the Claude launch path with a message naming the file.

- [ ] **Step 1: Desk survey.** From Claude Code's docs and `claude --help` (installed version: `claude --version`), list what `--setting-sources project` makes a `-p` session load from the project: `.claude/settings.json`, `.claude/commands`, `.claude/agents`, output styles, `.claude/skills`, `CLAUDE.md` and its `@` imports (can they reach outside the project, for example `@~/.ssh/id_rsa`?). For each: can it run a command, change the environment, widen tools, or pull in files from outside? Known already: subagents need the Task tool, absent from `--tools`; project skills fail `checkClaudeInit`; Ark's messages to agents start with `[Ark]` or a speaker label, never `/`.
- [ ] **Step 2: Ask the user** whether to run live probes (a few cheap `claude -p --model haiku` calls in a temp repo). Probes: (a) does `--settings '{"disableAllHooks":true}'` stop a project hook; (b) does a session reload `.claude/settings.json` written mid-session; (c) does a `CLAUDE.md` import of an absolute path outside the project get loaded. If the user says no, record "not verified live" and go on.
- [ ] **Step 3: Act on findings.** If (a) works, add `--settings`, `{"disableAllHooks":true}` to `claudeArgs` and update the exact-args test in `tests/main/isolation.test.ts`. If (c) loads outside files, refuse a project `CLAUDE.md` (or a file it imports) with an `@` import that resolves outside the project, reusing the containment logic in `engines/project-rules.ts`, with a test. If (b) reloads, record it as a known limit in the spec; no code change in this plan. Anything bigger: stop and ask the user.
- [ ] **Step 4: Run** `npm test` (PASS) and **commit** `docs: record what Claude loads from the project` (plus `fix: ...` if code changed).

---

### Task 3: Project code consent, once per thread (V1, V1b, I3)

**Files:**
- Modify: `src/shared/thread.ts` (`Thread`)
- Modify: `src/main/services/threads/workspace.ts` (add `checkCommands`)
- Modify: `src/main/services/engines/isolation.ts:42-76` (`claudeArgs` takes the commands; delete `CHECK_COMMANDS`, `CHECK_RULES`)
- Modify: `src/main/services/agent-runner.ts:57,96-103` (`startAgent` param)
- Modify: `src/main/services/engines/approval-policy.ts:17-30` (`decideApproval` param)
- Modify: `src/main/services/threads/conductor.ts` (`save`, `speak`, `approval`, `answer`, `dropApprovals`, `runBuild`)
- Test: `tests/main/isolation.test.ts`, `tests/main/workspace.test.ts`, `tests/main/approval-policy.test.ts`, `tests/main/agent-runner.test.ts`, `tests/main/conductor.test.ts`

**Interfaces:**
- Produces:
  - `Thread.projectCode?: 'allowed' | 'denied'` (absent = not asked yet).
  - `checkCommands(dir: string): string[]` in `workspace.ts`: `projectChecks(dir)` as a developer types them. Root names become `npm run <s>`, and `test` also adds `npm test`; subfolder and Python checks stay as they are (`npm --prefix web run lint`, `ruff check .`, `python -m pytest -q`).
  - `claudeArgs({ ..., checks?: string[] })`: in Ask build sessions `--allowedTools` gets `Bash(<c>)` and `PowerShell(<c>)` for each `c` of `checks` (none when empty or absent). Auto and Full args are unchanged.
  - `AgentRunner.startAgent(agent, projectDir, permissions?, permissionMode?, preferredEngine?, projectCode = false)`: Claude build sessions get `checks: projectCode ? checkCommands(projectDir) : []`. Codex args are unchanged.
  - `decideApproval(request, root, projectCode: boolean)`: the shell check branch allows only when `projectCode`; edits are unchanged.

- [ ] **Step 1: Write the failing unit tests**

```ts
// workspace.test.ts
test('checkCommands lists the checks as typed commands', () => {
  // package.json with test and lint, web/package.json with lint, pyproject with [tool.ruff]
  expect(workspace.checkCommands(d)).toEqual(['npm run lint', 'npm run test', 'npm test', 'npm --prefix web run lint', 'ruff check .']);
});
// isolation.test.ts
test('Ask build sessions preallow exactly the given check commands', () => {
  const a = claudeArgs({ ...base, permissions: 'build', permissionMode: 'ask', checks: ['npm run test'] });
  expect(a).toContain('Bash(npm run test)'); expect(a).toContain('PowerShell(npm run test)');
  expect(a.some((x) => x.startsWith('Bash(npm run lint'))).toBe(false);
  expect(claudeArgs({ ...base, permissions: 'build', permissionMode: 'ask' }).some((x) => x.startsWith('Bash('))).toBe(false);
});
// approval-policy.test.ts: existing allow cases pass `true`; add
test('a project check needs project code consent', () => {
  expect(decideApproval(command('npm test'), root, false).allow).toBe(false);
  expect(decideApproval(command('npm test'), root, true).allow).toBe(true);
});
test('every command Ark would preallow is a project check for Auto', () => {
  for (const c of workspace.checkCommands(d)) expect(isProjectCheck(c)).toBe(true);
});
```

In `agent-runner.test.ts`: a build start with `projectCode` true passes `Bash(npm run test)` in the Claude args for a project whose `package.json` has `test`; with false it passes none.

- [ ] **Step 2: Write the failing conductor tests** in `tests/main/conductor.test.ts`. Give the fake workspace `checkCommands: () => w.checks`. Existing build tests that set `ws.checks` in Ask or Auto must now answer the consent card (add a helper `allowProjectCode(c, t)` that finds the pending card and calls `c.answer(t.id, seq, true)`), or run in Full.

```ts
test('asks once per thread before the first developer turn when the worktree has checks', async () => {
  // Ask mode, ws.checks = ['test'], startDeveloper
  // -> one approval message: agent 'developer', tool "this repository's code", detail = CONSENT_DETAIL(['npm run test', 'npm test'])
  // -> no developer session started yet, thread.approvals contains its seq
  // answer(seq, true) -> developer starts with projectCode true; after its turn runChecks is called
  // phase 2: no new card; store.get(id).projectCode === 'allowed'
});
test('a denial skips Ark checks and preallows nothing, and is not asked again', async () => {
  // answer false -> developer starts with projectCode false; runChecks never called;
  // note 'Checks not run: you did not allow project code in this thread.'; the phase goes to the code review; phase 2: no card
});
test('no checks, no card; checks added later are asked before the first check run', async () => {
  // ws.checks = [] at start: no card, developer starts with projectCode false
  // the fake developer turn sets ws.checks = ['test'] -> card before runChecks; allow -> runChecks called
});
test('Full access asks nothing and stores nothing', ...);              // runChecks called, projectCode undefined
test('a pending consent card expires on pause and is asked again', ...); // Review Focus 1: pause, card not in approvals, resume -> new card
test('switching to Full with the card pending, then back to Ask, asks again', ...); // Review Focus 2
test('Codex developer with consent denied: no checks, same Codex start', ...);       // Review Focus 5: startAgent projectCode false, engine codex
test('Auto: a developer check command is allowed only after consent', ...);      // approval event Bash 'npm test' -> card when not allowed, auto-allowed after
```

Exact copy (put both in `protocol.ts` `NOTES` or next to the conductor code, one place):
- tool: `this repository's code`
- detail: ``Ark will run this repository's checks (${commands.join(', ')}) on your computer with your permissions, after each developer turn, for the rest of this thread. The developer can change what they run. Allow only if you would run this code yourself.``
- denied note: `Checks not run: you did not allow project code in this thread.`

The card reads "Developer wants to use this repository's code" through the existing `ApprovalCard`; no renderer change.

- [ ] **Step 3: Run, verify they fail.** Run: `npx vitest run tests/main/conductor.test.ts tests/main/isolation.test.ts tests/main/approval-policy.test.ts tests/main/workspace.test.ts tests/main/agent-runner.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement**
  - `save()`: also keep `projectCode: disk?.projectCode`, like `permissionMode`, so a turn's copy never overwrites the answer.
  - `private projectCode(threadId): boolean`: true when the on-disk thread is in Full mode or has `projectCode === 'allowed'`. `speak()` passes it as `startAgent`'s 6th argument; `approval()` passes it to `decideApproval`.
  - `private consent = new Map<string, { seq: number; done: (allow: boolean | undefined) => void }>()`. `private askProjectCode(t: Thread, commands: string[]): Promise<boolean | undefined>` appends the approval message, adds its seq with `setApprovals`, and resolves when answered (`undefined` when dropped).
  - `answer()`: when `seq` is the thread's consent seq, delete it, save `projectCode` on the disk thread (`'allowed'`/`'denied'`), drop the seq with a `decision` message, and resolve. Otherwise the current path.
  - `dropApprovals(threadId)` without `chatId` also resolves a pending consent with `undefined` and drops its seq (so `halt` expires it). With a `chatId` it leaves consent alone.
  - `runBuild`, develop/fix branch: when a fresh developer session is about to start, the mode is not Full, `projectCode` is undefined and `ws.projectChecks(worktree)` is not empty, `await askProjectCode(...)`, then `if (!live()) return`. Before `runChecks`: same condition, ask. Then run checks only if `this.projectCode(id)`; otherwise use `[]` results and the denied note in place of the checks note.
  - `claudeArgs`: replace `CHECK_RULES` with the `checks` option. `startAgent`: compute `checks` as above.

- [ ] **Step 5: Run, verify they pass.** Run: `npm test`. Expected: PASS.

- [ ] **Step 6: Try it in the app.** `npm run dev`, a test project with an npm `test` script, Ask mode, Start developer: the card shows, Allow runs the checks, a new thread with Deny shows the denied note.

- [ ] **Step 7: Commit** `feat: ask once per thread before running project code`

---

### Task 4: Explicit pytest and ruff flags in the Auto policy (V3)

**Files:**
- Modify: `src/main/services/engines/approval-policy.ts:6-14`
- Test: `tests/main/approval-policy.test.ts`

**Interfaces:** `isProjectCheck(command: unknown): boolean`, same signature.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  'python -m pytest -q', 'pytest -x -q tests/test_a.py::test_b', 'pytest -k "slow or fast" tests',
  'pytest --tb=short --maxfail=2', 'ruff check .', 'ruff check --fix src', 'ruff format --check .',
  '.venv/Scripts/python.exe -m pytest -q',
])('Auto allows a check with harmless flags: %s', (cmd) => expect(isProjectCheck(cmd)).toBe(true));

test.each([
  'pytest --basetemp=/audit-outside', 'ruff check --output-file=/audit-outside.txt',
  'pytest -p evil', 'pytest -c other.ini', 'pytest --rootdir=x', 'pytest -o cache_dir=/x',
  'ruff check --config=x.toml', 'pytest /etc', 'pytest C:/x', 'pytest ../x', 'ruff check --cache-dir=x',
])('Auto asks for flags that write, load or leave the worktree: %s', (cmd) => expect(isProjectCheck(cmd)).toBe(false));
```

- [ ] **Step 2: Run, verify the second group fails.** `npx vitest run tests/main/approval-policy.test.ts`
- [ ] **Step 3: Implement.** Replace `PY_ARG` with: flags from a fixed list, then positionals. Pytest flags: `-q -qq -v -vv -x -s -l --lf --ff --sw --no-header -r<letters> --tb=(auto|long|short|line|native|no) --maxfail=<n> --durations=<n> -k -m`. Ruff flags: `--fix --diff --statistics --show-fixes -q --quiet --no-cache --exit-zero --select=<codes> --ignore=<codes> --output-format=<word>`. Positionals: a relative path or test id (`\w`-first or `.`/`./...`, optional `::id` parts) or a quoted `"[\w .-]*"` expression; never a leading `/`, `\`, a drive or `..`. Keep the existing runner forms (`python3?|py|.venv...`) and the npm regex unchanged.
- [ ] **Step 4: Run** `npm test`, expected PASS.
- [ ] **Step 5: Commit** `fix: allow only harmless pytest and ruff flags without a card`

---

### Task 5: Skill frontmatter names and the top CLAUDE.md (V4, V5)

**Files:**
- Modify: `src/main/services/agent-runner.ts:88-95`
- Modify: `src/main/services/engines/project-rules.ts:45`
- Test: `tests/main/agent-runner.test.ts`, `tests/main/project-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// agent-runner.test.ts
test('forbids a project skill by its frontmatter name as well as its folder', async () => {
  // <project>/.claude/skills/local-folder/SKILL.md with "---\nname: different-name\ndescription: d\n---\n"
  await runner.startAgent(agent(), project);
  const { forbidden } = startClaude.mock.calls[0][0];
  expect(forbidden.has('local-folder')).toBe(true);
  expect(forbidden.has('different-name')).toBe(true);
});
// project-rules.test.ts
test('ignores a top CLAUDE.md that links outside the project', () => {
  const outside = project({ 'secret.md': 'SECRET' });
  const dir = project({});
  try { symlinkSync(join(outside, 'secret.md'), join(dir, 'CLAUDE.md'), 'file'); } catch { return; } // no symlink rights on this machine
  expect(codexProjectRules(dir)).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify they fail.** `npx vitest run tests/main/agent-runner.test.ts tests/main/project-rules.test.ts`
- [ ] **Step 3: Implement.** Runner: for each project skill entry also read `SKILL.md` and add `splitFrontmatter(text)?.data.name` when it is a string; an unreadable file adds nothing more. Project rules: `const top = realpathSync(claude); if (!inside(top)) return undefined; return expand(top, 0);`.
- [ ] **Step 4: Run** `npm test`, expected PASS.
- [ ] **Step 5: Commit** `fix: close the skill-name and CLAUDE.md link gaps`

---

### Task 6: Pause and permission change stop the checks (I1)

**Files:**
- Modify: `src/main/services/threads/workspace.ts:119-161,211-215`
- Modify: `src/main/services/threads/conductor.ts` (`ConductorDeps`, `halt`, `pause`, `setPermissionMode`, `removeProject`, the `runChecks` call)
- Modify: `src/main/ipc/index.ts:233,256,270` (handlers return the promises; no other change)
- Test: `tests/main/workspace.test.ts`, `tests/main/conductor.test.ts`

**Interfaces:**
- Produces: `workspace.runChecks(dir: string, scripts: string[], timeoutMs?: number, signal?: AbortSignal): Promise<CheckResult[]>`. On abort the running check is stopped with the existing tree kill (its tail starts `stopped\n`, `ok: false`), and the remaining scripts are not started.
- `ConductorDeps.checksStopMs?: number` (default `10_000`).
- `Conductor.pause(threadId): Promise<void>`, `Conductor.setPermissionMode(threadId, value): Promise<void>`, `Conductor.removeProject(projectId): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
// workspace.test.ts
test('runChecks stops the running check on abort and skips the rest', async () => {
  // package.json: "test": "node -e \"setTimeout(()=>{},60000)\"", "lint": "node -e \"\""
  const ac = new AbortController();
  const p = workspace.runChecks(d, ['test', 'lint'], 60_000, ac.signal);
  setTimeout(() => ac.abort(), 300);
  const r = await p;
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ script: 'test', ok: false });
  expect(r[0].tail.startsWith('stopped')).toBe(true);
});
// conductor.test.ts (fake runChecks resolves only after its signal aborts, then after 50 ms)
test('pause waits for the checks to stop before the thread goes idle', async () => {
  // during checks: const p = c.pause(id); expect(store.get(id).status).toBe('running'); await p;
  // expect(store.get(id).status).toBe('idle'); expect(fakeSignal.aborted).toBe(true)
});
test('pause gives up waiting after checksStopMs and says so', async () => {
  // checksStopMs: 50, fake never resolves: after await pause -> idle and a note
  // 'Processes started by the checks may still be running.'
});
test('pause with no checks running, or twice, resolves at once with no note', ...); // Review Focus 4
test('a permission change stops the checks too', ...);
```

- [ ] **Step 2: Run, verify they fail.** `npx vitest run tests/main/workspace.test.ts tests/main/conductor.test.ts`
- [ ] **Step 3: Implement.** `runScript` takes the signal and calls its `stop('stopped\n')` on abort (also when already aborted). `runChecks` stops the loop once the signal is aborted. Conductor: `private checks = new Map<string, { ac: AbortController; done: Promise<unknown> }>()`, set around the `runChecks` call in `runBuild` and cleared in a `finally` only if still its own entry. `halt()` aborts it. `pause` and `setPermissionMode`, after `halt`, await `Promise.race([done, timeout(checksStopMs)])`; on timeout they append the note above. Then they save, as today. `removeProject` awaits each `pause`. `stopAll` (quit) only aborts, no wait. Update existing callers and tests to `await` these methods.
- [ ] **Step 4: Run** `npm test`, expected PASS. Then `npm run dev`: pause during a slow check, the Git view stays busy until the thread goes idle.
- [ ] **Step 5: Commit** `fix: pause and permission changes stop the running checks`

---

### Task 7: Docs match the code (I4)

**Files:**
- Modify: `README.md` (around lines 67 and 169)
- Modify: `PROJECT.md` (around line 61)

- [ ] **Step 1: Edit README.** Read-only per engine: Claude advisors and reviewers have no edit, write or shell tools; Codex ones run in a read-only sandbox. Add the project code consent (once per thread, outside Full access, what Allow and Deny do) and the Claude settings allowlist (only `$schema`, `permissions.deny`, `permissions.ask`; anything else stops the session with the file and keys named). Handoff threshold: default 40%, configurable in Settings. Add Task 2's known limits, if any.
- [ ] **Step 2: Edit PROJECT.** One worktree per thread today; a worktree per agent stays roadmap.
- [ ] **Step 3: Check** there are no em dashes: `grep -nP "\x{2014}" README.md PROJECT.md` prints nothing.
- [ ] **Step 4: Final checks.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, all pass.
- [ ] **Step 5: Commit** `docs: describe agent permissions, consent and settings rules`
