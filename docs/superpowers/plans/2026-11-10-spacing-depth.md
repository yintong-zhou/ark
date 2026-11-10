# Spacing and Depth Implementation Plan

**Goal:** Refine Ark's spacing, rounded corners and tactile depth using existing components.

**Architecture:** Shared Tailwind tokens and semantic surface utilities; targeted component class updates and accessible line icons. No main-process, preload or data changes.

**Tech Stack:** React, TypeScript, Tailwind CSS 4, Electron.

**Spec:** `docs/superpowers/specs/2026-11-10-spacing-depth-design.md`

## Constraints and review focus

Preserve existing local modifications, palette, fonts, keyboard focus, 32px controls and resizable columns. Check the supported 960x600 minimum, tab overflow, narrow workspace panels, long text and input focus. No new dependencies, live tests, commits or user-profile writes.

## Tasks

- [x] Define radius/elevation tokens in `src/renderer/index.css` and control styles in `components/ui.ts`; align `brand-guidelines.md`.
- [x] Apply spacing and surface hierarchy to App, Shell, Page, Rail, TabStrip, Composer, Cards, Menu, Confirm and TaskBoard; use labeled icons for repetitive actions in ThreadView, Threads and Usage.
- [x] Run typecheck, lint, tests and build; launch isolated dev app, inspect screenshots and exercise the changed controls.

Visual-only changes use actual rendered layout checks rather than tests that duplicate class strings. Existing behavior tests remain the regression gate.

## Results

- Typecheck, lint, build passed. Offline suite: 49 files, 700 tests passed.
- Isolated dev profile: `.tmp/spacing-depth/profile`, verified through the main-process inspector before interaction. No live engine calls or user-profile writes.
- Screenshots inspected at 1200x760 and 960x600. Verified task toggle, edit/cancel, delete/keep, workspace tabs, menu bounds/search/focus restoration, emoji popup, Usage, Agents and project removal confirmation/cancel.
- Eight long file tabs keep the + button visible. A local native browser preview fits below the new tab strip and hides/reappears correctly around the action menu.
- Independent read-only review returned no findings. Existing local changes preserved; no commit or push performed.
