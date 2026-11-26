# Agent activity and team status

## Intent

While a thread runs, the user waits without knowing whether anything is happening. They should see, at a glance, that the session is alive, which agent is working, what it is working on, and when each agent has finished. Today the thread shows only a pulsing dot and "X is working"; nothing says what the agent is doing, and an agent that has finished looks the same as one that never started.

## Goals

- Each working agent shows a generic live line: its **task** (phase and step, or "Planning") plus its **current action** (Reading, Editing, Running, Searching, Thinking) and the time since the turn started. The user asked for both (task and action).
- A status for every agent in the team, in the existing team panel: **working**, **your turn**, **done**, **standby**.
- A progress row at the end of the conversation while an agent works, so the wait is visible where the user is looking. It disappears when the agent's message arrives.
- The same information for Claude and Codex agents.

## Non-goals

- No parallel agents. The conductor stays sequential: one `speaking` agent at a time. The panel must still work if that changes, because state is per agent.
- No path, command, file name or tool input in the activity line. Only the category.
- No history of activities, no log view, no token or cost changes.
- No new panel next to the existing team panel: the status lives in `TeamPanel`.

## Anti-goals

- Writing to disk on every tool call, or re-rendering the whole message list on every activity change.
- Leaking anything isolation hides (see `engines/isolation.ts`) or sensitive text into the UI.
- A stale "working" indicator after a pause, a crash, an error or an app restart.

## Constraints

- Ark rules in `CLAUDE.md` apply: hyphen instead of em dash, English UI text, colors and fonts from `brand-guidelines.md`, IPC payloads validated in main, a narrow typed preload API.
- Activity is transient, in memory only. Nothing about it enters the `Thread` JSON or the store.
- `chat:event` also reaches the Chat page and `shared/chat-log.ts`. The new event must not break that reducer.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then launch the app and watch a real thread. `npm run test:live` costs tokens: ask first.

## Approaches

1. **Transient channel, not persisted (selected).** Engines emit a new `activity` event. The conductor keeps a per-thread in-memory value and pushes it over a dedicated IPC channel. No disk writes, no `Thread` schema change, and a restart clears it, which is correct because nothing is running then. Cost: one more IPC channel and preload entry.
2. **A `thread.activity` field on `Thread`.** Reuses `save/emit` and needs no new IPC. Rejected: a turn makes dozens of tool calls, each one would rewrite the thread file and re-render the messages, and it needs throttling and cleanup on startup.

## Design

**Events.** Add `{ type: 'activity'; action: ActivityAction }` to `ChatEvent` (`src/shared/types.ts`), with `ActivityAction = 'thinking' | 'reading' | 'searching' | 'editing' | 'running' | 'other'`.
- Claude (`claude-session.ts`): on an `assistant` line, each `tool_use` content block is mapped by tool name (Read to reading, Grep and Glob to searching, Edit, Write and NotebookEdit to editing, Bash and PowerShell to running, anything else to other). A turn start (`send`) emits `thinking`.
- Codex (`codex-session.ts`): `item/started` is mapped by item type (command execution to running, file change to editing, reasoning to thinking, anything else to other).
- The mapping is a pure function in `src/shared/` with unit tests. It takes only the tool name or item type and returns the category.

**Conductor.** It already subscribes to `runner.onEvent`. On `activity` it finds the thread and agent behind the `chatId` and stores `{ agent, action, since }` per thread, in memory. It sends it with a new IPC event (`threads:activity`, payload validated) and answers `threads:get-activity` for a thread opened mid-turn. The value is cleared when `speaking` changes or becomes undefined, on pause, error, stop and delete. `since` is the turn start, set when `speaking` is set, not the action start, so the timer reads as the turn's elapsed time.

**Preload and renderer.** A typed `window.ark.threads.onActivity(cb)` and `window.ark.threads.activity(id)`. A small hook holds the latest activity per thread, and `ThreadView` and `TeamPanel` read it. The activity update must not re-render the message list: only the progress row and the team panel subscribe.

**Task line.** A pure function in `src/shared/thread-view.ts` builds it from `Thread`: for a speaker with a build role in `build`, "Phase i/n - step" from `build.phases[build.current]` and its `step`; for any speaker in `planning` or `team`, "Planning"; otherwise nothing. Reuse the existing phase and role helpers.

**Agent state.** A pure function in `src/shared/thread-view.ts`, `agentState(thread, messages, id)`:
- `working` if `thread.speaking === id`.
- `your turn` if `thread.waitingOn === id`.
- `done` if the agent has an agent message after the last user message or the last phase card, and it is neither working nor waiting. In the build phase this lasts until the next phase or cycle.
- `standby` otherwise (in the team, not yet spoken in this round). "Sleep" is the same state.
`Presence` in `Shell.tsx` gains `done` (a check mark, quiet color) and `standby` (hollow dot). The existing `speaking`, `waiting` and `idle` look is kept for working, your turn and standby.

**Progress row.** At the end of the message list, shown while `thread.speaking` is set and the thread is `running`: avatar, name, action label, task line, elapsed time, a pulse that respects reduced motion. If no `activity` has arrived yet, it shows "Thinking". The header status line keeps working as it does today.

**Failure modes.** A turn that ends in error, pause or stop clears the row. An approval wait does not clear it: the thread stays `running` with `speaking` set, so the row stays and its action reads "Waiting for approval", derived in the renderer from `thread.approvals`, with no conductor change. A thread opened mid-turn (after a renderer reload) asks main for the current activity once (see Conductor) and then follows the push channel.

**Calls made while writing this design (not discussed with the user).**
- Elapsed time: the conductor records `since` when it sets `speaking`, independent of any event, so the timer is right before the first `activity` arrives and after a reload. A request/response call `window.ark.threads.activity(id)` returns the current `{ agent, action, since }` or nothing, next to the push channel.
- `TeamPanel` rows: a working agent's row also shows the task line and action under its name, not only the state icon.
- Task line: shown only when the speaker holds a build role in the current phase (builder or reviewer). Other speakers in the build phase (the Head of Staff, for the summary or a follow-up) show the action only.
- Claude timing: without `--include-partial-messages`, each `assistant` line arrives complete just before its tool runs, so `tool_use` blocks give the label at tool start. No change to `claudeArgs` or the isolation flags. The tools Ark allows are Read, Glob, Grep, Skill, Edit, Write, Bash and PowerShell; Skill maps to other.

## Left to the builder

- Exact copy for the labels, spacing and animation, following `brand-guidelines.md` and the existing `Presence`.
- How the conductor maps `chatId` to thread and agent (it already tracks chats per thread for approvals).
- Whether the elapsed timer ticks in the row itself or from a shared clock hook, as long as it does not re-render the message list.
- The test layout: unit tests for the three pure functions and the event mapping, a conductor test for the clearing rules, a component test for the row and the panel.
