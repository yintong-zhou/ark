# Ark Phase 1, Step 4 - Auto routing and cost - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto picks the engine and tier by a deterministic rule (Claude by default, Codex for light and standard work when a Claude window is at 90% or more), the project manager can mark a task as hard (one tier up for that turn), and a thread shows its cost honestly: tokens per agent and per model, plus how the 5-hour and weekly windows moved while it ran.

**Architecture:**
- **Shared:** `agent-problems.ts` gets the routing rule (`tierUp`, `claudeLimited`, `resolveRun` with the switch). `usage-math.ts` gets `moveWindows` (window movement per thread). `thread-view.ts` gets `tokensBy` and the cost lines.
- **Engines:** both sessions emit a new `ChatEvent` `limits` from the engine's own rate-limit messages; `main/index.ts` feeds it to `UsageService`, so Ark-driven sessions keep the Usage screen and the switch current.
- **Conductor:** `{"next":…,"hard":true}` runs that turn in a fresh session one tier up; every turn records the window movement on the thread; a rerouted session leaves a note.
- **Renderer:** a "Thread cost" block at the bottom of `TeamPanel`; the build summary carries the same numbers.

**Tech Stack:** unchanged (Electron, electron-vite, React, TypeScript, Tailwind v4, Vitest, ESLint). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md`, §7 (model routing) and §9 (cost). Read both first. Step 3's plan (`docs/superpowers/plans/2026-11-06-phase1-step3-build-phases.md`) explains the conductor and the build loop.

**Verified on this machine (2026-11-06, Claude Code 2.1.312, codex-cli 0.167.0), use as given:**
- **Claude `rate_limit_event`** (stream-json, from the CLI bundle): `{"type":"rate_limit_event","rate_limit_info":{…},"uuid":"…","session_id":"…"}`. `rate_limit_info` holds `status` always, and when known `rateLimitType` (`"five_hour"`, `"seven_day"`, also `"seven_day_opus"`, `"seven_day_sonnet"`, `"overage"`), `utilization` (a fraction: the CLI's own thresholds are `0.9`, `0.75`) and `resetsAt` (epoch seconds). One event carries one window. `utilization` may be missing (spec §15 open question); Task 6 confirms the shape live.
- **Codex `account/rateLimits/updated`** (server notification): params `{ rateLimits: RateLimitSnapshot }`, the same shape as the `account/rateLimits/read` result, so `parseRateLimitsResult(params)` in `adapters/codex-appserver.ts` parses it as is. The update is sparse: `primary` or `secondary` may be `null`.

**Decisions taken here** (spec §14 leaves them to the builder; the user chose the first two):
- **The tier table is the agents' tiers.** The seeds already encode §7's table (manager light, planner standard, reviewers standard, developer heavy). Auto uses the agent's `tier`, bumped by `hard`; there is no second table that could disagree with the agent form.
- **Hard = a fresh session.** A manager `next` with `"hard": true` drops the member's live session, runs that one turn in a fresh session at `tierUp(tier)`, and drops it again, so the member's next turn is back at its own tier. A fresh session replays the transcript from the member's last handoff, as after a pause.
- **Windows come from the engines too.** Claude sessions parse `rate_limit_event`, Codex sessions `account/rateLimits/updated`; both go to `UsageService.apply`, so the switch works without the status line.
- **The 90% switch reads `UsageService`'s current Claude windows.** A window whose `resetsAt` is in the past counts as 0%. Only `engine: auto` agents move; heavy work (after the hard bump) stays on Claude.
- **Window movement** lives on the thread (`Thread.windows`), recorded before and after every turn for the engine that ran it. A window that reset during the thread starts again from 0%. *ponytail: the movement inside the old window is lost on reset; keep a list of windows if users ask.*
- **No header status line yet.** §9's per-thread header line duplicates the global status bar (bars) and the team panel (models); "agents running" is always 0 or 1 because one turn runs at a time. Left out; add it when parallel turns exist.

## Global Constraints

- UI copy in English; colors and fonts from `brand-guidelines.md`; accent `#00A896` only on calls to action.
- Limits are never shown as the thread's own cost: every window line says "including your other sessions" (spec §9).
- When an engine reports no percentage, only tokens are shown (spec §9).
- Agents with a fixed engine (`kind: 'engine'` or `kind: 'model'`) are never moved (spec §7).
- Switch threshold: **90%** of Claude's 5-hour **or** weekly window (spec §7).
- Ark only reads `~/.claude` and `~/.codex`. Don't weaken `engines/isolation.ts`.
- `npm test` never calls a model. `npm run test:live` costs tokens: ask the user before running it.
- Commits with `git commit -F <file>`, ending with the attribution trailer.

## Review Focus

1. **Expired windows** (`resetsAt` in the past, e.g. last week's statusline reading at 95%) must not trigger the switch and must not move a thread's numbers. Tests in Task 1 (`claudeLimited`) and Task 4 (`moveWindows`).
2. **`rate_limit_event` without `utilization` or `resetsAt`**, or with `rateLimitType` `seven_day_opus` / `overage`: no `limits` event, no crash. Test in Task 2.
3. **Sparse Codex update** with `primary: null`: only the secondary window is emitted, and `UsageService` keeps the old 5-hour window. Test in Task 2.
4. **A user message during a hard turn's wait, or the budget summary**, replaces the step: the new step has no `hard`. Test in Task 3.
5. **Pause or error during a hard turn**: the bumped session never serves the member's next normal turn. Test in Task 3.

---

### Task 1: The Auto rule (tier bump and the 90% switch)

**Files:**
- Modify: `src/shared/agent-problems.ts` (`RunPlan`, `resolveRun`, new `tierUp`, `SWITCH_AT`, `claudeLimited`)
- Modify: `src/shared/types.ts` (`ChatStarted`)
- Modify: `src/main/services/agent-runner.ts` (`RunnerDeps.claudeLimited`, `startAgent`)
- Modify: `src/main/index.ts` (wire `claudeLimited`)
- Test: `tests/main/models.test.ts`, `tests/shared/agent-problems.test.ts`, `tests/main/agent-runner.test.ts`

**Interfaces:**
- Produces:
  - `export const SWITCH_AT = 90;`
  - `export const tierUp = (t: Tier): Tier` - light → standard, standard → heavy, heavy → heavy.
  - `export function claudeLimited(st: { fiveHour?: UsageWindow; weekly?: UsageWindow } | undefined, nowSec: number): boolean` - true when either window has `resetsAt > nowSec` and `usedPct >= SWITCH_AT`.
  - `export type RunPlan = { engine: EngineId; tier: Tier; model?: string; rerouted?: true }`
  - `resolveRun(agent, installed, claudeLimited = false)`: for `kind: 'auto'`, when `claudeLimited && agent.tier !== 'heavy' && installed.codex`, the engine is `codex` with `rerouted: true`. Everything else as today.
  - `ChatStarted = { chatId; engine; model; rerouted?: true }`
  - `RunnerDeps.claudeLimited: () => boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/agent-problems.test.ts
test('tierUp', () => {
  expect(['light', 'standard', 'heavy'].map((t) => tierUp(t as Tier))).toEqual(['standard', 'heavy', 'heavy']);
});
test('claudeLimited: 90% of either live window', () => {
  const now = 1_000_000;
  const w = (usedPct: number, resetsAt = now + 60) => ({ usedPct, resetsAt, minutes: 300 });
  expect(claudeLimited({ fiveHour: w(90) }, now)).toBe(true);
  expect(claudeLimited({ weekly: { ...w(95), minutes: 10080 } }, now)).toBe(true);
  expect(claudeLimited({ fiveHour: w(89) }, now)).toBe(false);
  expect(claudeLimited({ fiveHour: w(99, now - 1) }, now)).toBe(false); // expired: Review Focus 1
  expect(claudeLimited(undefined, now)).toBe(false);
});
// tests/main/models.test.ts, inside test('resolveRun')
expect(resolveRun(agent({ kind: 'auto' }), both, true)).toEqual({ engine: 'codex', tier: 'light', rerouted: true });
expect(resolveRun(agent({ kind: 'auto' }, 'heavy'), both, true)).toEqual({ engine: 'claude', tier: 'heavy' });
expect(resolveRun(agent({ kind: 'auto' }), { claude: true, codex: false }, true)).toEqual({ engine: 'claude', tier: 'light' });
expect(resolveRun(agent({ kind: 'engine', engine: 'claude' }), both, true)).toEqual({ engine: 'claude', tier: 'light' });
expect(resolveRun(agent({ kind: 'model', engine: 'claude', model: 'opus' }, 'standard'), both, true)).toEqual({ engine: 'claude', tier: 'standard', model: 'opus' });
```

In `tests/main/agent-runner.test.ts`: `test('a limited Claude moves an auto agent to Codex')` - deps with both engines installed and `claudeLimited: () => true`, an auto light agent → `startCodex` is called, `startClaude` is not, and the result has `engine: 'codex', rerouted: true`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/shared/agent-problems.test.ts tests/main/models.test.ts tests/main/agent-runner.test.ts`
Expected: FAIL (`tierUp`, `claudeLimited` not exported; `rerouted` missing).

- [ ] **Step 3: Implement** the Interfaces above. `startAgent` calls `resolveRun(agent, installed, this.deps.claudeLimited())` and returns `rerouted` when the plan has it. `agentProblems` keeps calling `resolveRun` without the third argument. In `main/index.ts`: `claudeLimited: () => claudeLimited(usage.get().agents.find((a) => a.id === 'claude'), Date.now() / 1000)`. Add `claudeLimited: () => false` to every existing `RunnerDeps` fake.

- [ ] **Step 4: Run the tests, then `npm run typecheck`**

Expected: PASS, no type errors.

- [ ] **Step 5: Commit** `feat: Auto moves light and standard work to Codex when Claude is at 90%`

---

### Task 2: Engines report their windows

**Files:**
- Modify: `src/shared/types.ts` (`ChatEvent`)
- Modify: `src/main/services/engines/claude-session.ts`, `src/main/services/engines/codex-session.ts`
- Modify: `src/main/index.ts` (forward to `usage.apply`)
- Modify: any `ChatEvent` consumer with an exhaustive switch (`src/shared/chat-log.ts`, `src/preload/index.ts`, `conductor.ts`): `limits` is ignored there
- Test: `tests/main/claude-session.test.ts`, `tests/main/codex-session.test.ts`, `tests/main/usage.test.ts`

**Interfaces:**
- Consumes: `parseRateLimitsResult(result: unknown): UsageWindow[]` from `src/main/services/adapters/codex-appserver.ts`.
- Produces:
  - `ChatEvent` gains `| { type: 'limits'; engine: EngineId; windows: UsageWindow[] }` (never with an empty `windows`).
  - `export function claudeRateLimit(line: Record<string, unknown>): UsageWindow | undefined` in `claude-session.ts`: `five_hour` → `minutes: 300`, `seven_day` → `minutes: 10080`, any other type → undefined; `usedPct = Math.round(utilization * 100)`; missing `utilization` or `resetsAt` → undefined.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/claude-session.test.ts
test('rate_limit_event becomes a limits event', () => {
  // feed: {"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour","utilization":0.42,"resetsAt":1793900000}}
  // expect emitted: { type: 'limits', engine: 'claude', windows: [{ usedPct: 42, resetsAt: 1793900000, minutes: 300 }] }
});
test('rate_limit_event without a usable window emits nothing', () => {
  // three lines: {status} only; seven_day_opus with utilization and resetsAt; five_hour without utilization
  // expect: no 'limits' event, the session still works (a following result line still emits 'turn')
});
// tests/main/codex-session.test.ts
test('account/rateLimits/updated becomes a limits event', () => {
  // notification params: { rateLimits: { primary: null, secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1793988408 } } }
  // expect: { type: 'limits', engine: 'codex', windows: [{ usedPct: 16, resetsAt: 1793988408, minutes: 10080 }] }
});
// tests/main/usage.test.ts
test('a sparse update keeps the other window', () => {
  // apply codex windows [5h 40%, weekly 10%], then [weekly 12%] → fiveHour still 40%, weekly 12%
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/main/claude-session.test.ts tests/main/codex-session.test.ts tests/main/usage.test.ts`
Expected: the session tests FAIL (no `limits` event). The usage test may already pass: keep it, it pins Review Focus 3.

- [ ] **Step 3: Implement.** Claude: a `rate_limit_event` branch in the line handler, emitting only when `claudeRateLimit` returns a window. Codex: an `account/rateLimits/updated` branch in the notification handler, emitting when `parseRateLimitsResult(params)` is non-empty. `main/index.ts`: `runner.onEvent((_, e) => { if (e.type === 'limits') usage.apply({ agent: e.engine, windows: e.windows }); })`. Check that IPC still forwards chat events to the renderer and that the chat page ignores an unknown type.

- [ ] **Step 4: Run the tests, `npm run typecheck`, `npm run lint`**

Expected: PASS.

- [ ] **Step 5: Commit** `feat: Ark's own Claude and Codex sessions feed the usage windows`

---

### Task 3: The manager's hard flag

**Files:**
- Modify: `src/shared/thread.ts` (`Control`)
- Modify: `src/main/services/threads/protocol.ts` (`parseReply` `next`, `MANAGER_PROTOCOL`)
- Modify: `src/main/services/threads/rules.ts` (`Step`, `afterReply`)
- Modify: `src/main/services/threads/conductor.ts` (`run`, `speak`)
- Test: `tests/main/thread-protocol.test.ts`, `tests/main/thread-rules.test.ts`, `tests/main/conductor.test.ts`

**Interfaces:**
- Consumes: `tierUp` (Task 1).
- Produces:
  - `Control` `next`: `{ kind: 'next'; agent: string; hard?: true }` - set only when the block has `"hard": true` (any other value: absent).
  - `Step` turn: `{ do: 'turn'; agent: string; note?: string; hard?: true }`.
  - `Speak.hard?: true` - the fresh session starts with `{ ...def, tier: tierUp(def.tier) }`.
- Protocol line, appended to the `next` bullet of `MANAGER_PROTOCOL` (exact copy): `Add "hard":true when the task is hard: that one turn runs on a stronger model.`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/thread-protocol.test.ts
expect(parseReply('ok\n```ark\n{"next":"planner","hard":true}\n```').control).toEqual({ kind: 'next', agent: 'planner', hard: true });
expect(parseReply('ok\n```ark\n{"next":"planner","hard":"yes"}\n```').control).toEqual({ kind: 'next', agent: 'planner' });
// tests/main/thread-rules.test.ts
test('hard passes from the manager next to the step', () => {
  // planning thread, team [MANAGER, 'planner']; afterReply(t, MANAGER, { kind:'next', agent:'planner', hard:true }) → step { do:'turn', agent:'planner', hard:true }
});
test('an interrupt or the budget drops hard', () => {   // Review Focus 4
  // same reply with interrupt { to: undefined } → step { do:'turn', agent: MANAGER } (no hard)
  // same reply with agentTurns = PLANNING_BUDGET - 1 → step to MANAGER with NOTES.budget, no hard
});
// tests/main/conductor.test.ts
test('a hard turn runs in a fresh session one tier up, then the member goes back to its own', async () => {
  // planner (tier standard) has a live session; the manager replies {"next":"planner","hard":true}
  // expect: the old planner session is stopped; startAgent is called with tier 'heavy';
  // after the planner's reply that session is stopped; the planner's next turn starts with tier 'standard'
});
test('a paused hard turn leaves no bumped session behind', async () => {  // Review Focus 5
  // pause while the hard turn runs; the user writes @planner → startAgent called with tier 'standard'
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/main/thread-protocol.test.ts tests/main/thread-rules.test.ts tests/main/conductor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `afterReply` step 3 copies `control.hard` into the step; steps 4 and 5 already build new step objects, so `hard` drops (keep it that way). `run()`: when `step.hard`, `dropSession(id, agent)` before `speak(…, { hard: true })` and again after it returns; the existing catch already drops the session on failure, and `halt` drops it on pause.

- [ ] **Step 4: Run the tests, `npm run typecheck`**

Expected: PASS.

- [ ] **Step 5: Commit** `feat: the project manager can mark a task as hard`

---

### Task 4: Window movement and the reroute note

**Files:**
- Modify: `src/shared/thread.ts` (`WindowMove`, `Thread.windows`)
- Modify: `src/shared/usage-math.ts` (`moveWindows`)
- Modify: `src/main/services/threads/protocol.ts` (`NOTES.rerouted`)
- Modify: `src/main/services/threads/conductor.ts` (`ConductorDeps.windows`, engine per chat, `speak`)
- Modify: `src/main/index.ts` (wire `windows`)
- Test: `tests/shared/usage-math.test.ts`, `tests/main/conductor.test.ts`

**Interfaces:**
- Consumes: `ChatStarted.engine`, `ChatStarted.rerouted` (Task 1).
- Produces:
  - `export type WindowMove = { from: number; to: number; resetsAt: number };`
  - `export type ThreadWindows = Partial<Record<EngineId, { fiveHour?: WindowMove; weekly?: WindowMove }>>;` and `Thread.windows?: ThreadWindows`.
  - `export function moveWindows(have: ThreadWindows | undefined, engine: EngineId, reading: { fiveHour?: UsageWindow; weekly?: UsageWindow } | undefined, nowSec: number): ThreadWindows | undefined` - per window: an expired or missing reading changes nothing; no move yet → `{ from: usedPct, to: usedPct, resetsAt }`; same window (resets within 60 s, as `mergeWindow`) → `to = max(to, usedPct)`; a later window → `{ from: 0, to: usedPct, resetsAt }`. Returns `have` itself when nothing changed.
  - `ConductorDeps.windows: (engine: EngineId) => { fiveHour?: UsageWindow; weekly?: UsageWindow } | undefined`
  - `NOTES.rerouted(name: string)` (exact copy): `` `Claude is at ${SWITCH_AT}% or more of a usage window: ${name} runs on Codex.` ``

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/usage-math.test.ts
test('moveWindows', () => {
  const now = 1_000_000, r = now + 3600;
  const five = (usedPct: number, resetsAt = r) => ({ fiveHour: { usedPct, resetsAt, minutes: 300 } });
  let w = moveWindows(undefined, 'claude', five(41), now);
  expect(w).toEqual({ claude: { fiveHour: { from: 41, to: 41, resetsAt: r } } });
  w = moveWindows(w, 'claude', five(44, r + 2), now);
  expect(w?.claude?.fiveHour).toEqual({ from: 41, to: 44, resetsAt: r });
  expect(moveWindows(w, 'claude', five(99, now - 1), now)).toBe(w);        // expired: Review Focus 1
  expect(moveWindows(w, 'claude', undefined, now)).toBe(w);
  expect(moveWindows(w, 'claude', five(3, r + 18000), now)?.claude?.fiveHour).toEqual({ from: 0, to: 3, resetsAt: r + 18000 });
});
// tests/main/conductor.test.ts
test('a turn records how the windows moved', async () => {
  // deps.windows returns claude 5h 41% before the turn and 44% after (switch the fake inside runner.turn)
  // expect: the saved thread has windows.claude.fiveHour { from: 41, to: 44 }
});
test('a rerouted session leaves a note', async () => {
  // fake startAgent returns { engine: 'codex', rerouted: true } → a note NOTES.rerouted('Planner') is stored before the reply
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/shared/usage-math.test.ts tests/main/conductor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** The conductor keeps `chatId → engine` from `startAgent`'s result (dropped with the session). In `speak`, apply `moveWindows` for the chat's engine right before `runner.turn` and again right after it, on the local `t` that the reply's `save` writes. A rerouted fresh session: `save(t, [note])` right after it is registered. `main/index.ts`: `windows: (e) => usage.get().agents.find((a) => a.id === e)`. Add `windows: () => undefined` to the existing fakes.

- [ ] **Step 4: Run the tests, `npm run typecheck`**

Expected: PASS.

- [ ] **Step 5: Commit** `feat: threads record how the usage windows moved while they ran`

---

### Task 5: Thread cost in the team panel and the summary

**Files:**
- Modify: `src/shared/thread-view.ts` (`tokensBy`, `windowLines`)
- Modify: `src/main/services/threads/protocol.ts` (`NOTES.summary`)
- Modify: `src/main/services/threads/conductor.ts` (summary arguments)
- Modify: `src/renderer/components/TeamPanel.tsx`
- Test: `tests/shared/thread-view.test.ts`, `tests/main/thread-protocol.test.ts`

**Interfaces:**
- Consumes: `ThreadWindows` (Task 4), `TokenLine` component.
- Produces:
  - `export function tokensBy(messages: ThreadMessage[], key: (m: AgentMessage) => string): Record<string, TokenCount>`; `tokensByAgent(messages)` becomes `tokensBy(messages, (m) => m.agent)`.
  - `export function windowLines(w: ThreadWindows | undefined): string[]` - one line per window, Claude first, 5-hour before weekly, exact copy `` `${'Claude' | 'Codex'} ${'5h' | 'weekly'} ${from}% → ${to}%` ``. Empty when no engine reported a percentage.
  - `NOTES.summary` takes `{ branch, phases, tokens: string[], windows: string[] }`; when `windows` is non-empty it appends `\nUsage windows (including your other sessions):\n- …`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/thread-view.test.ts
test('tokensBy model', () => {
  // two agent messages on 'claude-haiku-4-5' (10 in / 2 out each) and one on 'gpt-5.5' → { 'claude-haiku-4-5': {input:20,cached:0,output:4}, 'gpt-5.5': {...} }
});
test('windowLines', () => {
  expect(windowLines({ codex: { weekly: { from: 10, to: 12, resetsAt: 1 } }, claude: { fiveHour: { from: 41, to: 44, resetsAt: 1 } } }))
    .toEqual(['Claude 5h 41% → 44%', 'Codex weekly 10% → 12%']);
  expect(windowLines(undefined)).toEqual([]);
});
// tests/main/thread-protocol.test.ts
test('the summary lists the window movement', () => {
  // NOTES.summary({ ..., windows: ['Claude 5h 41% → 44%'] }) contains 'Usage windows (including your other sessions):\n- Claude 5h 41% → 44%'
  // with windows: [] it does not contain 'Usage windows'
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/shared/thread-view.test.ts tests/main/thread-protocol.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Summary (`runBuild`, `step.do === 'summary'`): `tokens` lines per agent and model, `` `${name} (${model}): ${input} in / ${output} out` ``, keyed with `tokensBy(…, (m) => `${m.agent}\n${m.model}`)`; `windows: windowLines(t.windows)`.
  - `TeamPanel`: a "Thread cost" section pinned under the agent list, with `section` heading style as the groups: one row per model (`ModelMark`, `shortModel`, `TokenLine`), then the `windowLines` rows in `text-meta text-muted`, then one line "Including your other sessions" only when there are window rows. No accent color.

- [ ] **Step 4: Run the tests, `npm run typecheck`, `npm run lint`**

Expected: PASS.

- [ ] **Step 5: Commit** `feat: thread cost per model and window movement in the team panel and summary`

---

### Task 6: Live check, README, and the full checks

**Files:**
- Modify: `tests/live/engines.live.test.ts`
- Modify: `README.md` (Threads section)

- [ ] **Step 1: Add the live test** `test('a Claude turn reports its usage window')`: a light Claude agent, one-line prompt; collect `limits` events until `turn`; expect at least one window with `minutes` 300 or 10080, `usedPct` between 0 and 100, `resetsAt` after now. If none arrives, the test fails with the raw `rate_limit_event` lines it saw (log them), so the parser can be fixed from real data.
- [ ] **Step 2: Ask the user** before `npm run test:live -- -t "usage window"` (it costs tokens). If they agree, run it; if `utilization` turns out not to be a fraction, fix `claudeRateLimit` and its test, and write the real shape into this plan's "Verified" list.
- [ ] **Step 3: README**, Threads section, after the build paragraph: Auto (agent tier; `hard` one tier up for one turn; light and standard work on Codex when a Claude window is at 90% or more; fixed engines never move) and the Thread cost block (tokens per model; window movement, including other sessions).
- [ ] **Step 4: Run** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Expected: all green.
- [ ] **Step 5: Manual check in dev mode** (`npm run dev`): open a thread with a few turns; the Thread cost block shows the models and, once a window reading exists, a line like `Claude 5h 41% → 44%`. Screenshot for the user.
- [ ] **Step 6: Commit** `docs: Auto routing and thread cost in the README; live usage-window test`
