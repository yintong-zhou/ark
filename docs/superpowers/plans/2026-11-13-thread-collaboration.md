# Thread Collaboration Implementation Plan

> **For agentic workers:** Execute the tasks in dependency order, using `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Checkboxes track work. Preserve the user's existing uncommitted changes.

**Goal:** Keep Ark threads useful after a build, improve team communication and role-appropriate skills, and align access controls with the message composer.

**Architecture:** Retain the existing conductor, state machine, Git services and isolated agent sessions. Separate build completion from thread availability, start further build cycles in the same worktree, and introduce explicit, validated Git actions. Improve the context and instructions agents receive without relaxing permissions.

**Tech stack:** Electron, TypeScript, React, Vitest, existing Git runner and Claude/Codex adapters.

**Spec:** `docs/superpowers/specs/2026-11-13-thread-collaboration-design.md`.

## Global constraints

- Follow `AGENTv2.md`, project security and brand rules. UI text is English; use hyphens instead of em dashes.
- Only builders write during build in the thread worktree. Full access is the only existing approval bypass; review waivers retain their card. Do not weaken isolation.
- Retain automatic build phase commits. Final commits, merges and pushes require an explicit user request. Never push as a deletion side effect.
- Keep historical threads readable and `build.removed` irreversible. Preserve unrelated uncommitted work. No paid live-engine tests without permission.
- Do not commit this plan or implementation unless the user explicitly requests it.

## Review focus

- A message arrives during the final summary: it is delivered once, including after restart (Task 1).
- Legacy finished thread has a removed or missing worktree: conversation remains useful, but a build cannot silently recreate it (Tasks 1-2).
- A new build follows an earlier build: previous phases and reviews remain available and no review waiver is implied (Task 2).
- A Git target is dirty, ambiguous, diverged or changes before execution: preserve work and report the precise blocker (Task 4).
- An installed skill has hooks, prohibited tools, private paths, duplicate names or unsupported invocation settings: no isolation bypass or false claim of application (Task 5).

## Task 1: Deliver follow-up messages after completion

**Files:** Modify `src/main/services/threads/conductor.ts`, `src/main/services/threads/rules.ts`, `src/main/services/threads/build-rules.ts`, `src/shared/thread.ts` and persistence only if required. Test `tests/main/conductor.test.ts`, `tests/main/thread-rules.test.ts`, `tests/main/thread-store.test.ts`.

**Interfaces:** Keep `Conductor.send(threadId: string, text: string, files?: Upload[]): void`; callers continue using existing thread updates. A completed build remains recorded while the Head receives follow-up messages.

- [ ] Add failing tests: sending to a completed thread invokes the Head with the message, and a message arriving during summary is delivered once after the summary. Persist/reload the latter and test a legacy done thread. A missing/removed worktree must not prevent a read-only answer.
- [ ] Run `npx vitest run tests/main/conductor.test.ts tests/main/thread-rules.test.ts tests/main/thread-store.test.ts`; verify the new cases fail for the expected behavior.
- [ ] Replace the terminal `done` routing with a persisted, restart-safe conversation continuation. Keep generation cancellation, ordering and interrupt semantics; do not drop messages during the summary. Retain completion metadata.
- [ ] Run the same command and verify all cases pass.

## Task 2: Start another reviewed build in the same worktree

**Files:** Modify `src/main/services/threads/conductor.ts`, `src/main/services/threads/build-rules.ts`, `src/main/services/threads/workspace.ts`, `src/shared/thread.ts`, `src/main/services/threads/store.ts` as needed. Test `tests/main/build-rules.test.ts`, `tests/main/conductor.test.ts`, `tests/main/workspace.test.ts`, `tests/main/thread-store.test.ts`.

**Interfaces:** Reuse `startBuild` and `Workspace` at their existing boundaries; extend persisted build history compatibly so the current worktree, branch and completed phases remain available to later turns.

- [ ] Add failing tests: a follow-up change runs planning and a new build on the same branch/worktree, retains previous outcomes and applies checks, reviewer selection and waiver gates again. Reopen after restart. A removed or missing worktree yields a clear blocker and is never silently recreated.
- [ ] Run `npx vitest run tests/main/build-rules.test.ts tests/main/conductor.test.ts tests/main/workspace.test.ts tests/main/thread-store.test.ts`; confirm the new cases fail.
- [ ] Implement the smallest backward-compatible cycle representation and route an approved follow-up plan into the existing worktree. Reuse its recorded path and branch, take the baseline from its HEAD, and give each cycle a distinct plan filename. Reset review waivers for each new cycle; preserve permission mode, prior phase evidence and user messages; never reset `removed`.
- [ ] Run the same command and verify it passes.

## Task 3: Improve team handoffs and routing

**Files:** Modify `src/main/services/threads/protocol.ts`, `src/main/services/threads/conductor.ts`, `src/main/services/threads/rules.ts`, `src/main/services/threads/build-rules.ts` as necessary. Test `tests/main/thread-protocol.test.ts`, `tests/main/thread-rules.test.ts`, `tests/main/conductor.test.ts`.

**Interfaces:** Preserve existing `Control` blocks and `PLANNING_BUDGET`; pass relevant user requirements and builder outcome to reviewer turns via the existing notes/transcript boundary. Honor model locks and existing `Level` routing.

- [ ] Add failing tests for actionable handoffs, relevant user requirements reaching fresh reviewers, bounded member routing, and locked models remaining unchanged. Verify output still parses existing Ark control blocks.
- [ ] Run `npx vitest run tests/main/thread-protocol.test.ts tests/main/thread-rules.test.ts tests/main/conductor.test.ts`; confirm new assertions fail.
- [ ] Update protocol instructions and handoff context to encourage concise natural communication, explicit blockers and evidence, and role-appropriate escalation. Keep read-only planning and existing security boundaries.
- [ ] Run the same command and verify it passes.

## Task 4: Explicit final Git actions and safe deletion

**Files:** Modify `src/main/services/git/repo.ts`, `src/main/services/git/worktrees.ts`, `src/main/services/git/run.ts` only where needed, `src/main/services/threads/conductor.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`, shared IPC types and `src/renderer/components/ThreadView.tsx` as needed. Test `tests/main/git.test.ts`, `tests/main/git-rules.test.ts`, `tests/main/conductor.test.ts` and focused renderer tests.

**Interfaces:** Use typed, validated thread-scoped requests for status, commit, merge and push through preload and IPC; route all Git UI operations through the existing no-hooks, no-prompt Git services. Require an explicit user action for each final mutation, with source and target visible.

- [ ] Add failing integration tests using temporary repositories: status distinguishes uncommitted files and unpushed commits; no remote, dirty target, ambiguous target, diverged branch, conflict and changed state produce accurate results without overwriting work. Deleting a thread never pushes or silently commits; dirty work blocks deletion until the user explicitly chooses a safe resolution. Verify no action is triggered by summary alone.
- [ ] Run `npx vitest run tests/main/git.test.ts tests/main/git-rules.test.ts tests/main/conductor.test.ts`; confirm the new cases fail.
- [ ] Implement status-based suggestions and user-requested final actions accessible from the conversation; reuse `threadBranch` and `mergeBranch` where applicable. Resolve ambiguous merge targets with the user, validate and recheck state immediately before execution, and surface errors and conflict recovery. Block merging while a subsequent cycle is being planned or built. Block deletion of dirty work until the user explicitly resolves it; never silently commit or push on deletion.
- [ ] Run the same command and verify it passes; exercise the request-to-result path through the thread UI.

## Task 5: Isolated role-appropriate communication skills

**Files:** Modify `src/main/services/skills.ts`, `src/main/services/agent-runner.ts`, `src/main/services/threads/protocol.ts`, `src/main/services/engines/isolation.ts` only if necessary; add isolated bundled resources if needed. Test `tests/main/skills.test.ts`, `tests/main/agent-runner.test.ts`, `tests/main/isolation.test.ts` and `tests/main/thread-protocol.test.ts`.

**Interfaces:** Preserve `AgentRunner.startAgent(...)` and `buildSkillFolder(...)` contracts; communicate the selected style through isolated session instructions and surface an unavailable or incompatible skill rather than pretending it ran.

- [ ] Add failing tests for general versus technical role selection, task-dependent Ponytail/i-have-adhd, both Claude and Codex, explicit agent selections, missing and duplicate skills, disabled model invocation, hooks, unsafe `allowed-tools`, and personal-path references. Assert no hooks or private personal files become accessible.
- [ ] Run `npx vitest run tests/main/skills.test.ts tests/main/agent-runner.test.ts tests/main/isolation.test.ts tests/main/thread-protocol.test.ts`; confirm new cases fail.
- [ ] Implement actual usable isolated skill instructions, including a safe adapted Humanizer with attribution and without its personal-file references. Do not assume plugin hooks execute or enable them. Preserve explicit agent skill isolation and existing tool approval boundaries; report meaningful limitations.
- [ ] Run the same command and verify it passes. Inspect the generated session instructions for both engines without starting paid sessions.

## Task 6: Align access selector with composer

**Files:** Modify `src/renderer/components/ThreadView.tsx`, `src/renderer/components/Composer.tsx`, `src/renderer/components/PermissionSelect.tsx`, `src/renderer/components/Icons.tsx` as needed. Add or update focused renderer tests.

**Interfaces:** Preserve `PermissionSelect` mode, disabled and accessible-label behavior. Composer remains usable at narrow widths and the menu must not obscure conversation text when closed.

- [ ] Add a focused renderer test that the selector and message composer share the intended row, with accessible name, disabled behavior and keyboard-operable menu. Run the focused test and observe the new layout assertion fail.
- [ ] Move the selector into the composer alignment and draw line icons matching existing Ark icons. Preserve file attachment, emoji, multiline and narrow-width behavior.
- [ ] Run the focused renderer test and confirm it passes. Launch the app in dev mode and inspect the thread at normal and narrow widths; report any launch blocker honestly.

## Task 7: Whole-change verification

**Files:** Update `README.md` for thread continuation, explicit Git operations and skill behavior; review the complete diff without touching unrelated changes.

- [ ] Check the spec against every task and verify all acceptance cases, including state recovery and existing permissions.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; each must exit zero. Do not run `npm run test:live` without permission.
- [ ] Confirm the UI and user-visible flow in the running app. Review the combined changes for security, regressions and preserved unrelated work. Report checks, limitations and any remaining blockers.
