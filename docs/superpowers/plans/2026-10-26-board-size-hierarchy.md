# Board Size Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved subtle size hierarchy to all board views.

**Architecture:** Board presentation metadata owns relative widths. A pure
function fits their shared reference envelope; the existing board renderer
applies the result to its common drawing/overlay/logo wrapper.

**Tech Stack:** Existing TypeScript, React, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-board-size-hierarchy-design.md`.

## Global Constraints

- Widths: Mega 125 %, Uno 100 %, Nano 85 %, ATtiny 65 % at normal sizes.
- Compact contrast: 60 % at fitted Uno viewport width <=160 px, full at >=280 px.
- Keep SVG geometry, pin semantics and common-centre alignment unchanged.
- No dependencies; preserve prior artwork work. Initial delivery was uncommitted.
  Follow-up authorization on 2026-10-27 permits push, merge into
  `feature/browser-emulation` and cleanup after verification.

## Review Focus

- A wide or tall panel must preserve the chosen ordering: unit ratio tests.
- Compact or hidden panels must fit without a minimum-zoom overflow: bounds tests.
- Resizing must not make a board shrink as space grows: monotonicity tests.
- Switching boards must keep the reference envelope and centre: browser test.
- Pin input/analog dialogs must stay aligned after scaling: artwork E2E suite.

## Task 1: Shared presentation scale and renderer integration

**Files:**
- Modify `client/src/lib/board-view.ts`, `client/src/components/features/arduino-board.tsx`.
- Modify `tests/client/components/arduino-board-views.test.tsx`.
- Create `tests/client/lib/board-display-scale.test.ts`, `e2e/board-display-scale.spec.ts`.
- Update `assets/boards/README.md`, `CHANGELOG.md` and the Boards SSOT.

**Interfaces:**
- Consumes `boardView(BoardId)` and panel client dimensions.
- Produces `BoardView.relativeWidth: number` and
  `boardDisplayScale(board: BoardId, width: number, height: number, margin = 4): number`.

- [x] Add metadata ratio assertions and run them against the old metadata.
  Expected: assertion failure for missing `relativeWidth`.
- [x] Add pure sizing tests for desktop ratios, compact attenuation,
  all-board bounds/order, invalid space and monotonic resize.
- [x] Implement the metadata and shared-envelope function in `board-view.ts`.
  Validate finite dimensions, preserve aspect ratios and safe margins.
- [x] Integrate with the renderer's layout/resize lifecycle; remove the 0.1
  minimum scale and keep the native SVG wrapper width from flex shrinking.
- [x] Add actual board-switch/resizing browser coverage and document the policy.
- [x] Run focused tests, `npm run check`, `npm run lint`, `npm run check:docs`,
  `./run-tests.sh --knip-gate-only`, full `npm run test:unit`, production build
  and sizing plus ATtiny/Nano/Mega browser tests. Expected: all pass.
- [x] Obtain one focused read-only review, resolve material findings, and
  copy the verified changes back to the workspace without committing.
