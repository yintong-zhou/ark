# New Tab Menu Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this focused change inline.

**Goal:** Replace the workspace's Browser/Terminal buttons with a searchable `+` dropdown.

**Architecture:** Extend the existing Menu with optional search and item presentation. A NewTabMenu composes existing terminal and browser actions, with root selection still owned by Threads.

**Tech Stack:** React, TypeScript, existing Tailwind tokens, Vitest, Electron.

**Spec:** `docs/superpowers/specs/2026-11-10-new-tab-menu-design.md`

## Global constraints

- Only terminal and browser commands; preserve the bottom panel and one browser tab per project.
- No dependencies, engine changes, main/preload changes or live engine tests.
- Keep previous logo and browser icon changes intact. No commits or publishing requested.

## Review focus

- Chosen shells open the panel without an extra default shell, including a selected worktree root.
- Closing the panel while creation is pending must remain effective.
- Keyboard search, empty results, Escape and outside clicks close/focus correctly.
- Menus near viewport edges and above a live native browser remain usable.
- Unmounting a menu/project during shell discovery must not reopen it.

### Task 1: Menu and terminal actions

- [x] Add failing tests in `tests/renderer/terms-store.test.ts` for direct shell creation revealing the panel and respecting a later hide during startup. Run the focused test file and confirm the expected failure.
- [x] Update `src/renderer/terminal/terms-store.ts` so `create(projectId, root, shell)` reveals the panel when requested. Run focused tests.
- [x] Extend `src/renderer/components/Menu.tsx` with optional search, icons, hints and keyboard navigation while retaining existing callers.
- [x] Add `src/renderer/components/NewTabMenu.tsx` to load shell options safely and compose terminal/browser actions.
- [x] Update `TabStrip.tsx` and `pages/Threads.tsx` to anchor `+` beside tabs and pass the current root. Update Terminal and Browser instructions in `README.md`.
- [x] Run typecheck, lint, tests and build. In a temporary dev profile verify filtering, empty results, keyboard/outside dismissal, browser activation, chosen shell startup, panel hide/show and overlay behavior. Inspect a screenshot and the final diff.
