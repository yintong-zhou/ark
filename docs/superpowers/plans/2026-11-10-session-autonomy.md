# Session Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session permission modes, real Claude/Codex distribution, autonomous team decisions and Git-ignored styling.

**Architecture:** Keep capability separate from permission policy. Main validates structured approvals and thread transitions; the conductor retains ordered turns and stable engine sessions. Git supplies ignored metadata through the existing safe runner.

**Tech Stack:** Electron, React, TypeScript, Vitest, local Claude Code and Codex CLI protocols.

**Spec:** `docs/superpowers/specs/2026-11-10-session-autonomy-design.md`

## Global Constraints

- Preserve existing local changes; use current checkout because UI work required by this task is uncommitted here.
- Personal skills, memory, plugins and MCP remain excluded.
- Only the developer writes during build; Full access is the approved explicit exception to the engine worktree boundary.
- UI text is English; use existing brand fonts/colors and hyphens.
- No new dependency, global engine-config writes or subscription-backed tests.
- Verify typecheck, lint, unit tests, build and temporary-profile dev behavior.

## Review Focus

- Unsupported CLI approval semantics must fail closed, never pretend to classify unobserved actions.
- A policy change while a turn or approval is active must stop sessions and invalidate approvals.
- Existing threads retain manual gates; new threads default to Auto only through the creation API.
- Engine pins and live sessions stay stable even when capacity preferences change.
- Ignore changes refresh all expanded affected directories, with tracked files and unusual names handled correctly.

---

### Task 1: Permission policy and engine adapters

**Files:** Create `src/shared/permissions.ts`, `src/main/services/engines/approval-policy.ts`; modify `src/shared/types.ts`, `src/shared/thread.ts`, `src/main/services/agent-runner.ts`, `src/main/services/engines/isolation.ts`, `src/main/services/engines/claude-session.ts`, `src/main/services/engines/codex-session.ts`; extend engine/isolation tests and add `tests/main/approval-policy.test.ts`.

**Interfaces:** `PermissionMode = 'ask' | 'auto' | 'full'`; `permissionMode(value: unknown): PermissionMode` validates IPC input; `modeOf(t: { permissionMode?: PermissionMode }): PermissionMode` returns legacy `'ask'`. `startAgent` takes an optional fourth mode argument. Approval events gain optional structured metadata for engine/tool/input/cwd. `decideApproval(request, root): { allow: boolean; reason: string }` allows only recognized routine actions; callers ask for everything else.

- [ ] Inspect installed CLI help/schema for supported gates using read-only commands. Do not start paid turns.
- [ ] Add tests proving mode validation, structured command approval, unknown requests, compound syntax, external paths and full/read-only isolation behavior; run to confirm failure.
- [ ] Implement contracts and adapter policies with pre-execution gates. Codex Auto must reject startup if its protocol cannot provide the required gate; preserve Ask and explicit Full access.
- [ ] Run targeted policy/adapter/isolation/runner tests; require PASS.

### Task 2: Thread routing across real engines

**Files:** Modify `src/shared/agent-problems.ts`, `src/main/services/agent-runner.ts`, `src/main/services/threads/conductor.ts`, `src/main/services/threads/protocol.ts`, `src/shared/thread.ts`; extend `tests/shared/agent-problems.test.ts`, `tests/main/agent-runner.test.ts`, `tests/main/conductor.test.ts`.

**Interfaces:** Add optional routing context to runner startup containing an Auto preference selected by the conductor. A pure `chooseEngine` accepts role, assignments, installed engines and usage pressure. Thread assignments retain the actual engine/model, and each agent message records its engine.

- [ ] Add tests for complementary Auto roles, both providers' capacity, expired/unknown windows, pinned models, single engine and stable sessions; run RED.
- [ ] Implement thread-local role affinity and balanced assignment, retaining existing model tiers and explicit profiles.
- [ ] Include effective engine/model in transcript/roster and update routing notes without retaining Claude-only restart logic.
- [ ] Run routing/runner/conductor tests; require PASS.

### Task 3: Autonomous conductor and per-session UI

**Files:** Modify `src/main/services/threads/{store,rules,protocol,conductor}.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/hooks/useThreads.ts`, `src/renderer/pages/Threads.tsx`, `src/renderer/components/{ThreadView,TeamPanel}.tsx`; create `src/renderer/components/PermissionSelect.tsx`; extend thread rules/store/conductor tests.

**Interfaces:** `create(projectId, text, files?, mode?)` defaults new threads to Auto. `setPermissionMode(threadId, value)` halts/drops sessions and stores the effective policy. Main exposes narrow `threads:set-permission-mode` IPC. Rules use `modeOf` to permit validated member handoffs and route specialist asks to manager. Auto approval decisions are logged as notes; sensitive requests keep existing approval cards.

- [ ] Add tests for old/new defaults, policy change with active turn/cards, automatic team/plan progression, internal asks, invalid/self/out-of-team handoffs, pause and bounded planning; run RED.
- [ ] Implement policy persistence and main/preload validation, then automatic transitions through the existing safe team/build paths.
- [ ] Implement manager-first internal questions and controlled handoffs; keep finite correction/review budgets and explicit blocker escalation.
- [ ] Add branded accessible permission selector before creation and on each thread, showing effective policy and broad Full access description. Display actual engine/model on team and messages. Keep direct Chat read-only and label that capability.
- [ ] Run all thread/routing/IPC-relevant tests and typecheck; require PASS.

### Task 4: Git-ignored metadata and styling

**Files:** Create `src/main/services/files/ignored.ts`; modify `src/main/ipc/index.ts`, `src/shared/files.ts`, `src/renderer/files/tree-store.ts`, `src/renderer/components/FileTree.tsx`; add `tests/main/files-ignored.test.ts` and refresh tests.

**Interfaces:** `markIgnored(root: string, rel: string, listing: DirListing): Promise<DirListing>` augments `FileEntry.ignored?: boolean` using a batched NUL-delimited `git check-ignore` through `gitNow`/`queued`.

- [ ] Add temporary-repo tests for folders, nested rules, negation, tracked files, unusual names, worktrees/non-Git and inspection failures; run RED.
- [ ] Implement safe batched lookup and listing integration. Refresh expanded directories when ignore config changes.
- [ ] Style ignored names italic and attenuated, retaining selection/focus/hover and adding `Ignored by Git` title.
- [ ] Run ignored/files/tree regression tests; require PASS.

### Task 5: Verification, review and documentation

**Files:** Update `README.md`, `PROJECT.md`, relevant architecture notes for approved Full access exception, and this plan. Temporary dev fixtures live only in `.tmp/`.

- [ ] Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`; fix task-caused failures and record unrelated limits accurately.
- [ ] Review the task diff for approval bypasses, stale async saves, false model labels and preserved local changes. Use a fresh reviewer as required by the execution skill.
- [ ] Launch dev with an asserted temporary profile; use fake engines/threads for selector, autonomous flow and ignored-file checks. Close only the verified test instance.
- [ ] Update docs with actual supported CLI behavior and verification results. No commits or live tests without a separate user request.

Plan self-review: all four approved requirements and the five review-focus cases have owners above. Execute natively to avoid multiple agents editing the same conductor and existing UI changes; no further design decision is required.
