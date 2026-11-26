# Agent Activity and Team Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, for every agent in a thread, whether it is working, waiting for the user, done or on standby, and for a working agent what it is doing (task plus current action) with elapsed time.

**Architecture:** Engines emit a new transient `activity` ChatEvent (a category only). The conductor keeps one in-memory `{ agent, action, since }` per thread, derived from `speaking` plus engine events, and pushes it over a dedicated IPC channel; nothing is persisted. Per-agent state and the task line are pure functions in `src/shared/`. The renderer shows them in `TeamPanel` and in a progress row at the end of the conversation.

**Tech Stack:** Electron, TypeScript, React, Tailwind, vitest (`renderToStaticMarkup` for components).

**Spec:** `docs/superpowers/specs/2026-11-26-agent-activity-design.md`

## Global Constraints

- Hyphen (-) instead of em dash in all text and code comments; UI text in English; colors and fonts from `brand-guidelines.md`.
- Activity is transient and in memory only: no field on `Thread`, no store write, no disk write per tool call.
- Only a category crosses the boundary (`'thinking' | 'reading' | 'searching' | 'editing' | 'running' | 'other'`): never a path, command, file name or tool input.
- Do not touch `claudeArgs` or any isolation flag (`engines/isolation.ts`).
- Activity updates must not re-render the message list: only the progress row and `TeamPanel` subscribe.
- IPC: the main process validates the thread id (`uuid(id, 'thread')`), the preload exposes narrow typed functions, no raw `ipcRenderer`.
- Do not commit unless the user asks; each task ends with a checkpoint of the checks, not a commit.
- `npm run test:live` costs tokens: never run it unprompted.

## Review Focus

Failure modes the spec implies that no happy-path test would hit, most likely first. Each has its test in the task named.

1. A "working" indicator that survives a pause, an error or a turn end (Task 3: clearing test).
2. A late event from a chat that is no longer the speaker overwriting the current agent's action (Task 3).
3. An activity event for an unknown chat or a removed thread throwing or leaking a map entry (Task 3).
4. A tool input (a shell command, a path) reaching the UI through the activity payload (Task 2 and Task 3).
5. The plain Chat page breaking on the new event, and a legacy build thread with no `build` crashing the task line (Task 1 and Task 4).

---

### Task 1: Shared types, activity mapping, labels

**Files:**
- Create: `src/shared/activity.ts`
- Modify: `src/shared/types.ts` (ChatEvent at ~line 257; `window.ark.threads` at ~line 139-156), `src/shared/chat-log.ts` (the `switch`)
- Test: `tests/shared/activity.test.ts`, `tests/shared/chat-log.test.ts`

**Interfaces:**
- Produces, in `src/shared/activity.ts`:
  - `type ActivityAction = 'thinking' | 'reading' | 'searching' | 'editing' | 'running' | 'other'`
  - `type ThreadActivity = { agent: string; action: ActivityAction; since: number }`
  - `claudeAction(tool: string): ActivityAction`
  - `codexAction(itemType: string): ActivityAction | undefined` (undefined = no event)
  - `activityLabel(action: ActivityAction | undefined, awaitingApproval: boolean): string`
  - `elapsed(ms: number): string`
- Produces, in `types.ts`: `ChatEvent` gains `{ type: 'activity'; action: ActivityAction }`; `window.ark.threads` gains `onActivity(cb: (threadId: string, a: ThreadActivity | undefined) => void): () => void` and `activity(id: string): Promise<ThreadActivity | undefined>`.

- [ ] **Step 1: Write the failing tests** in `tests/shared/activity.test.ts`:
  - `claudeAction`: Read to `reading`; Glob and Grep to `searching`; Edit, Write and NotebookEdit to `editing`; Bash and PowerShell to `running`; Skill and an unknown name to `other`.
  - `codexAction`: `reasoning` to `thinking`; `commandExecution` to `running`; `fileChange` to `editing`; `webSearch` to `searching`; `mcpToolCall` to `other`; `agentMessage` and `userMessage` to `undefined`.
  - `activityLabel`: `thinking` to `Thinking`; `reading` to `Reading files`; `searching` to `Searching`; `editing` to `Editing code`; `running` to `Running a command`; `other` and `undefined` to `Working`; any action with `awaitingApproval` true to `Waiting for approval`.
  - `elapsed(42_000)` is `0:42`; `elapsed(3_725_000)` is `1:02:05`; `elapsed(-5)` is `0:00`.
  Add to `tests/shared/chat-log.test.ts`: `chatReducer(state, { type: 'event', event: { type: 'activity', action: 'running' } })` returns `state` itself (same reference).
- [ ] **Step 2: Run** `npx vitest run tests/shared/activity.test.ts tests/shared/chat-log.test.ts`. Expected: FAIL (module and case missing).
- [ ] **Step 3: Implement** `src/shared/activity.ts` with the signatures above (plain lookup tables; `elapsed` is `m:ss`, with hours when 3600 s or more). Add the `activity` member to `ChatEvent`, the two methods to the `window.ark.threads` type, and `case 'activity': return s;` to `chatReducer`. Codex item names are camelCase as already seen (`agentMessage`, `commandExecution`); confirm the rest against the local protocol schema without calling the engine (`codex app-server generate-ts`), and fix the table if a name differs.
- [ ] **Step 4: Run** the same command, then `npm run typecheck`. Expected: tests PASS; typecheck reports only the missing preload and handler wiring from Task 4 (the `window.ark` implementation lacks the two methods). If it does, continue; Task 4 closes it.
- [ ] **Step 5: Checkpoint:** list the files changed. No commit unless asked.

### Task 2: Engines emit `activity`

**Files:**
- Modify: `src/main/services/engines/claude-session.ts` (the `assistant` branch, ~line 90), `src/main/services/engines/codex-session.ts` (`client.onNotification`, ~line 155)
- Test: `tests/main/claude-session.test.ts`, `tests/main/codex-session.test.ts`

**Interfaces:**
- Consumes: `claudeAction`, `codexAction` from Task 1.
- Produces: sessions emit `{ type: 'activity', action }` through the existing `onEvent`.

- [ ] **Step 1: Write the failing tests.**
  - Claude: feed an `assistant` line whose content has a `tool_use` block `{ name: 'Bash', input: { command: 'rm -rf secret' } }` and a text block. Assert the events include exactly `{ type: 'activity', action: 'running' }` (deep equality, so no input text can ride along) and still include the `message` event for the text. A line with two tool_use blocks (Read then Edit) emits two events in order. A line with only text emits no `activity`.
  - Codex (use `fakeAppServer`): an `item/started` notification with `item.type: 'commandExecution'` emits `{ type: 'activity', action: 'running' }`; with `item.type: 'agentMessage'` emits none.
- [ ] **Step 2: Run** `npx vitest run tests/main/claude-session.test.ts tests/main/codex-session.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Claude: in the `assistant` branch, for each content block with `type === 'tool_use'` and a string `name`, `emit({ type: 'activity', action: claudeAction(name) })`, before the text `message` event is not required but keep `message` behavior unchanged. Codex: handle `method === 'item/started'`: read `item.type` as a string, `const a = codexAction(type)`, emit only when defined. No emit at turn start: the conductor defaults to `thinking` when `speaking` is set.
- [ ] **Step 4: Run** the same command. Expected: PASS, and the existing tests in both files still PASS.
- [ ] **Step 5: Checkpoint:** `npm run typecheck` shows only the Task 4 gaps. No commit unless asked.

### Task 3: Conductor tracks activity per thread

**Files:**
- Modify: `src/main/services/threads/conductor.ts` (constructor `runner.onEvent`, `emit` at ~line 421, `remove` at ~line 367)
- Test: `tests/main/conductor.test.ts` (uses `fakeRunner`, whose `emit(chatId, event)` fires runner events)

**Interfaces:**
- Consumes: `ThreadActivity`, `ActivityAction` (Task 1); `sessions` (threadId to agentId to chatId) already in the conductor.
- Produces:
  - `conductor.onActivity(cb: (threadId: string, a: ThreadActivity | undefined) => void): () => void`
  - `conductor.activity(threadId: string): ThreadActivity | undefined`

- [ ] **Step 1: Write the failing tests** in `tests/main/conductor.test.ts`:
  - `activity: a speaking agent starts as thinking and follows engine events`: after a turn starts for an agent (reply held pending), `conductor.activity(id)` is `{ agent, action: 'thinking', since }` with `since` a number; `runner.emit(chatId, { type: 'activity', action: 'editing' })` makes it `editing` with the same `since`, and the `onActivity` callback received the new value. The payload's keys are exactly `agent`, `action`, `since` (nothing else).
  - `activity: an unchanged action is not pushed again`: emitting `editing` twice calls the callback once for it.
  - `activity: cleared when the turn ends, on pause and on error`: after the reply arrives, after `pause`, and after an engine error, `conductor.activity(id)` is `undefined` and the callback received `undefined` for the thread.
  - `activity: ignores events from a chat that is not the speaker`: with agent A speaking, an `activity` event for agent B's chat (or an unknown chat id, or a removed thread's chat) changes nothing and does not throw.
  - `activity: removing a thread drops its entry`.
- [ ] **Step 2: Run** `npx vitest run tests/main/conductor.test.ts -t activity`. Expected: FAIL (methods missing).
- [ ] **Step 3: Implement.**
  - A `private readonly liveActivity = new Map<string, ThreadActivity>()` and a listener set, with `onActivity` and `activity` as above.
  - In `emit(thread, added)` (the single choke point for every thread update): if `thread.speaking` is set and differs from the stored entry's agent, store `{ agent: thread.speaking, action: 'thinking', since: Date.now() }` and notify; if `thread.speaking` is unset and an entry exists, delete it and notify `undefined`. Do this before calling the thread listeners, and guard listener errors like the existing loop does.
  - In the constructor's `runner.onEvent`: for `e.type === 'activity'`, find the `(threadId, agent)` whose `sessions` chatId equals `chatId`; if the stored entry for that thread has that same agent and a different action, replace the action (keep `since`) and notify; otherwise ignore.
  - In `remove`, delete the thread's entry and notify `undefined` (after the existing cleanup).
- [ ] **Step 4: Run** `npx vitest run tests/main/conductor.test.ts`. Expected: new tests PASS and the whole file still PASSES.
- [ ] **Step 5: Checkpoint:** no commit unless asked.

### Task 4: IPC and preload

**Files:**
- Modify: `src/main/ipc/index.ts` (beside `threads:pause`, ~line 372), `src/main/index.ts` (beside `conductor.onUpdate`, ~line 165), `src/preload/index.ts` (the `threads` object, ~line 95-110)

**Interfaces:**
- Consumes: `conductor.activity`, `conductor.onActivity` (Task 3); the `window.ark.threads` types (Task 1).
- Produces: channel `threads:get-activity` (invoke, validated id) and event `threads:activity` with args `(threadId, activity | undefined)`.

- [ ] **Step 1: Implement.** `handle('threads:get-activity', (id) => conductor.activity(uuid(id, 'thread')))`. In `main/index.ts`: `conductor.onActivity((id, a) => { if (!win.isDestroyed()) win.webContents.send('threads:activity', id, a); })`. In preload: `activity: (id) => ipcRenderer.invoke('threads:get-activity', id)` and `onActivity: (cb) =>` the same subscribe and unsubscribe shape as `onUpdate`.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint`. Expected: clean (this closes the gap left by Tasks 1 and 2).
- [ ] **Step 3: Checkpoint:** no commit unless asked.

### Task 5: Pure views: agent state and task line

**Files:**
- Modify: `src/shared/thread-view.ts`
- Test: `tests/shared/thread-view.test.ts`

**Interfaces:**
- Consumes: `cyclePhases(b, cycle)` (already in this file), `Thread.roles`, `Thread.build`, `Thread.speaking`, `Thread.waitingOn`.
- Produces:
  - `type AgentState = 'working' | 'waiting' | 'done' | 'standby'`
  - `agentState(t: Thread, messages: ThreadMessage[], id: string): AgentState`
  - `taskLine(t: Thread, agent: string): string | undefined`

- [ ] **Step 1: Write the failing tests** in `tests/shared/thread-view.test.ts`:
  - `agentState`: `speaking === id` is `working`; `waitingOn === id` is `waiting`; an agent message after the last user message is `done`; a user message after it makes it `standby`; a `phase` message after it makes it `standby`; no messages is `standby`; `note`, `reaction`, `approval` and `decision` messages never make an agent `done`; another agent's message does not.
  - `taskLine`: phases `team` and `planning` give `Planning` for any speaker. In `build` with a builder from `roles.builders` and `build.phases[current]` at step `develop`, index 1 of 3, it gives `Phase 2/3 - develop`; the code reviewer at step `review` gives `Phase 2/3 - code review`; the security reviewer at step `security` gives `Phase 2/3 - security review`. The Head of Staff speaking in `build` gives `undefined`. A `build` thread with no `build` field gives `undefined` and does not throw. Phase `done` gives `undefined`.
- [ ] **Step 2: Run** `npx vitest run tests/shared/thread-view.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** both functions with the signatures above. `agentState` precedence is working, waiting, done, standby; "done" looks only at messages after the last `user` or `phase` message. In `taskLine`, a speaker has a build role when `roles` lists it as builder, code reviewer or security reviewer, or when the current phase's `builder` is that agent; use the current cycle's phases (`cyclePhases(t.build, t.build.cycle)`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint:** no commit unless asked.

### Task 6: Renderer: hook, presence states, team panel, progress row

**Files:**
- Create: `src/renderer/hooks/useActivity.ts`, `src/renderer/components/ProgressRow.tsx`
- Modify: `src/renderer/components/Shell.tsx` (`Presence`, ~line 106), `src/renderer/components/TeamPanel.tsx`, `src/renderer/components/ThreadView.tsx` (end of the message list, and the scroll effect at ~line 64)
- Test: `tests/renderer/progress-row.test.ts` (new), `tests/renderer/team-panel.test.ts`

**Interfaces:**
- Consumes: `ThreadActivity`, `activityLabel`, `elapsed` (Task 1); `agentState`, `taskLine` (Task 5); `window.ark.threads.activity` and `onActivity` (Task 4).
- Produces:
  - `useActivity(threadId: string | undefined): ThreadActivity | undefined`: subscribes to `onActivity` filtered by id, loads the current value once with `activity(id)`, resets when the id changes, ignores a late reply for an old id.
  - `Presence` state union becomes `'speaking' | 'waiting' | 'idle' | 'done' | 'standby'`.
  - `ProgressRow({ thread, agents, activity?, now? })`.

- [ ] **Step 1: Write the failing tests.**
  - `progress-row.test.ts` (render with `renderToStaticMarkup`, passing `activity` and `now` as props): a running thread with `speaking: 'dev'` and `{ agent: 'dev', action: 'editing', since: 0 }` at `now: 42_000` shows the agent's name, `Editing code` and `0:42`, plus the task line when `taskLine` gives one. With no `activity`, it shows `Thinking`. With `thread.approvals = [3]` it shows `Waiting for approval`. A thread with `status: 'waiting'` or no `speaking` renders nothing (empty markup). The markup contains no command or path text.
  - `team-panel.test.ts`: with `speaking: 'dev'` and `activity` passed, the working agent's row shows its action label and task line; the Head of Staff with an agent message after the last user message shows state `done` (screen-reader label); an agent in the team that has not spoken shows `standby`; `waitingOn` still shows `your turn`. The existing cost-label test must keep passing.
- [ ] **Step 2: Run** `npx vitest run tests/renderer/progress-row.test.ts tests/renderer/team-panel.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
  - `Presence`: keep `speaking` (the existing breathing dot; its label becomes `working`), `waiting`, `idle`; add `done` (a check mark in the quiet color, reuse an existing check icon if one exists in `Icons.tsx` or `StateIcons`) and `standby` (a hollow ring). Grep the tests for the old `speaking` label and update any that assert it.
  - `useActivity` as specified above.
  - `ProgressRow`: reads `useActivity(thread.id)` and a one-second clock, each overridable by the `activity` and `now` props; renders only when `thread.status === 'running' && thread.speaking`; avatar, name, `activityLabel(activity?.action, (thread.approvals?.length ?? 0) > 0)`, `taskLine`, `elapsed(now - since)` where `since` falls back to `now` when there is no activity yet; the dot uses the existing `breathe` class (it already respects reduced motion).
  - `TeamPanel`: add the optional `activity?: ThreadActivity` prop defaulting to `useActivity(thread.id)`; map `agentState` to `Presence` (`working` to `speaking`, `waiting`, `done`, `standby`); a working agent's row also shows `activityLabel` and `taskLine` under the name. Keep the roles, model and token lines.
  - `ThreadView`: render `<ProgressRow thread={thread} agents={agents} />` after the message `<ol>` and before `<div ref={end} />`, and add `thread.speaking` to the dependencies of the scroll-into-view effect so the row is visible when it appears. Do not pass `activity` down from any parent: the row owns its subscription.
- [ ] **Step 4: Run** `npx vitest run tests/renderer` then `npm run typecheck && npm run lint`. Expected: PASS and clean.
- [ ] **Step 5: Checkpoint:** no commit unless asked.

### Task 7: Verification in the real app

**Files:** none (a note in `docs/handoff/` is the user's call, not part of this plan).

- [ ] **Step 1: Run** `npm run typecheck && npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 2: Launch** `npm run dev` (if "Electron uninstall": `node node_modules/electron/install.js`), open a project, start a thread with a small request that makes the Head of Staff read files. Confirm in the window: the progress row appears at the end of the conversation with an action and a running timer; the team panel shows the Head of Staff as working with the same action, then `done` when it answers, and the other agents as `standby`; pausing clears the row; reloading the window during a turn shows the row again with the correct elapsed time. Report what was and was not observed.
- [ ] **Step 3: Ask the user** before running `npm run test:live`; do not run it otherwise.
