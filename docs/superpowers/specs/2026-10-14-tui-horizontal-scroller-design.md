# Phase 3b: Reusable Horizontal Scroller

## Intent And Status

Add a reusable one-row horizontal scroller to the local component library and
adopt it for the workspace bar and the status bar's content area. Overflow must
remain readable without abbreviating labels or reviving workspace paging.

Phases 1–3 and the user's follow-up styling changes are accepted. The handoff
confirms a verified baseline of 652 passing tests plus build/smoke; older pending
verification notes in the adoption roadmap do not reopen those phases.

The user approved this written design and its separate implementation plan before
product code changes. The core implementation is verified, reviewed, and accepted
by the user; components-demo follow-up verification is pending. Work stays in the existing
`use-component-lib-in-tui` worktree. Preserve its index and existing work; leave
all new changes unstaged and uncommitted. Prefer native/inline execution.

## Compatibility Findings

- `ScrollArea` already supplies horizontal scrolling, clipping, native layout
  geometry, wheel containment, refs, and focused-descendant reveal.
- Native `showArrows` belongs to a horizontal scrollbar below its viewport. It
  cannot supply arrows beside content while keeping header/status height at one.
- Native focus reveal does not observe ToggleGroup's browsing candidate: the
  group remains the single native focus endpoint while that candidate changes.
- Local `Button` always makes an enabled button focusable. Using it unchanged
  for arrows would add header Tab stops and allow pointer scrolling to take
  focus from another region, terminal, or dialog.
- Native mouse dispatch applies automatic focus after handlers unless the event
  is default-prevented. Non-focusable arrows alone are insufficient because a
  focusable ancestor could still receive focus.
- Native wheel handling keeps up/down vertical, except for Shift remapping.
  A horizontal-only component needs local ordinary-wheel remapping.
- Native `scrollChildIntoView` uses nearest-edge reveal. An oversized target can
  remain partially visible without its beginning being exposed; the agreed
  oversized-label rule needs a small geometry-based adjustment.

## Approved Composition And Library Contract

These engineering choices were included in the approved written design; they are
not changes already made to the library.

Add `packages/tui/src/ui/components/horizontal-scroller.tsx`, exported directly
as `HorizontalScroller`, with ordinary themed horizontal layout props and an
optional `revealId` naming a rendered descendant. No application types,
selection state, keyboard bindings, custom imperative handle, dependency,
barrel, configurable scrolling policy, or separate generic arrow component.

Compose existing `HStack`, `ScrollArea`, `Box`, and `Text`/`Icon`. Configure the
viewport for horizontal-only scrolling with native scrollbar tracks hidden and
keyboard fallback off. Keep content on one unwrapped row using native intrinsic
layout; do not compute label widths in application code. Retain native scrolling
and bounds rather than implementing a second offset/layout engine.

Use small non-focusable arrow surfaces inside this component. This substitutes
local primitives for Button only because Button's required focusability violates
the approved focus contract. Do not extend Button, ToggleGroup, or ScrollArea.
Arrow press handlers must prevent native autofocus and stop propagation to
surrounding controls, including when that direction is unavailable.

`revealId` is the only proposed special public prop: it lets the caller identify
a browsing candidate without moving native focus. With no reveal target, manual
scrolling remains independent of keyboard focus. Missing/removed targets are
harmless; no focus or selection repair belongs to this component.

Use post-layout native geometry to update overflow, arrows, and reveal. Native
scroll methods own offset changes and bounds. Subscribe locally only where
needed; dispose listeners and pending reveal work on unmount. Do not introduce
another global keyboard or input-policy listener.

## Agreed Arrow And Pointer Behavior

- Option A: no arrows or reserved arrow space when content fits. During overflow,
  reserve a one-cell arrow at each end. An unavailable direction stays visible
  but muted and cannot scroll. Fit detection uses the available width before
  subtracting arrow cells so arrows do not perpetuate overflow by themselves.
- Both arrows share the content's row. Hide them if fewer than three cells are
  available, leaving any usable space for content. Zero-width viewports are safe.
- A primary-button release inside the pressed arrow moves half the current
  viewport width, rounded down with a minimum of one cell, clamped to the bounds.
  Release outside, canceled gestures, secondary buttons, and stale gestures after
  removal/disablement do not scroll. No hold-to-repeat or animation.
- Native horizontal wheel scrolling stays available. Ordinary wheel up/down
  moves left/right. Preserve native horizontal/Shift-wheel usability and avoid
  double scrolling; exact event adaptation is left to the builder.
- Wheel reports over the arrow cells also belong to this scroller. Contain wheel
  events at either boundary instead of scrolling an ancestor.
- Arrow/wheel scrolling changes only the viewport: it must not change keyboard
  focus, workspace browsing candidate, active workspace, or activation intent.

## Agreed Keyboard, Reveal, And Resize Behavior

- The scroller and arrows are not focus endpoints or Tab stops and own no keys.
- ToggleGroup retains its existing browsing, wrapping, refocus reset, buffered
  input, and Enter/Space activation behavior. Browsing requests reveal without
  activating the candidate.
- Reveal an entry completely when it fits, using the smallest needed movement.
  If it is wider than the viewport, reveal its beginning on browse/refocus; mouse
  scrolling can expose the rest. Do not truncate, add ellipses, or wrap.
- Manual scrolling is not undone on ordinary renders/frames. A new browse or
  refocus requests reveal. On resize, preserve/clamp the offset where possible;
  when the workspace group is focused, keep its browsing candidate visible.
- Content mutations must update native bounds and arrow eligibility. Reordering,
  renaming, or removing entries must not leave a focused browsing candidate
  outside the viewport because a reveal used stale geometry. Existing
  ToggleGroup behavior owns candidate repair; the scroller only reveals it.
- Status content is pointer-scrollable only. No new keyboard shortcut or focus
  stop is introduced for hints. Terminal and dialog input ownership stays intact.

## Caller Adoption

### Workspace Bar

Keep `region:workspace` on the existing ToggleGroup as the sole native endpoint.
Compose the scroller inside the group so the endpoint continues to represent the
full available workspace region, including arrows, for header traversal and
spatial geometry. A small caller-local composition may read the already-exported
ToggleGroup context to pass its focused browsing candidate as `revealId`.

Do not move selection or browsing into the shell. Keep `workspace:<id>` entry
IDs, rendered order, complete names, custom foreground/background colors,
outlined numbers 1–10, and omission of number icons beyond ten. Keep workspace
mouse activation distinct from pointer scrolling: clicking an entry still follows
its existing primary-release activation and drill-down route.

Header Tab/Shift+Tab still traverses only workspace and session controls. Keep the
session switcher outside the workspace scroller, with its full label and existing
native flex layout. No manual workspace/session label-sizing policy is added.

### Status Bar

Keep `status` one row tall and retain the nine-cell mode Badge outside the
scrollable content area. Preserve its margin, colors, all key glyphs, leader
formatting, action text, and span colors.

Use the same scroller content slot for HINTS, LEADER, INFO, and ERROR, rather than
maintaining parallel message rendering paths. Reset offset to the beginning when
the displayed mode/hints/message changes, based on semantic values rather than
React object identity; ordinary rerenders preserve manual scrolling. Prefer an
ordinary React key for this reset over adding a second special library prop.

Pointer scrolling here must not activate hint actions or focus the status bar.
Application overlays continue to leave this row uncovered and undimmed. Scrolling
visible status content during a dialog must not disturb the dialog's focus or
allow background workspace interaction.

## Scope And Invariants

Expected changes reach the new component and its colocated tests, both caller
files and their tests, representative shell integration tests, and Phase 3b
documentation. No new exports barrel, dependencies, config, fixtures, server
protocol, durable state, or architectural shared navigation are needed.

Preserve Session → Workspace → Category → Navigator activation drill-down,
global/leader priority, modal policy, terminal identity/input/replay, and the
one-row header/status. No Phase 4 navigator migration, workbench migration,
restyling, warning cleanup, or redo of accepted phases.

## Verification And Delivery Gate

Use TDD for new scrolling behavior and affected integration contracts. Cover:

- Fit/overflow transitions, both edges, stable arrow slots, narrow/zero space,
  wide glyphs, long labels, content mutation, and resize/clamping.
- Primary-release arrow increments and canceled gestures; vertical, horizontal,
  and shifted wheel input; containment and preserved native focus/selection.
- Buffered workspace browsing/activation, wrapping/refocus reveal, oversized
  label beginnings, manual-offset persistence, rendered ordering, and one header
  focus endpoint with unchanged Tab/global/leader behavior.
- Semantic status resets, all modes and key formatting, fixed badge, and status
  scrolling without stealing terminal/modal focus or changing overlay policy.
- Listener cleanup and preservation of terminal identity and PTY input through
  existing representative shell/entrypoint coverage.

Run focused tests, then fresh `bun run check` including build/smoke. Keep the
existing `/bin/sh` test-daemon setting; do not diagnose known listener-limit or
React act warnings as part of this change. Obtain independent read-only review,
address findings with regression coverage, and report verification honestly.

Finally pause for the user's manual verification of scrolling, resize, focus,
activation, hint readability, and overlays. Do not progress into Phase 4.

## Delivered Checkpoint

- Approved plan: [2026-10-14-tui-horizontal-scroller.md](../plans/2026-10-14-tui-horizontal-scroller.md).
- Native execution with TDD; full labels use native unbounded horizontal viewport
  measurement, not application label widths. No existing library API extensions.
- Fresh bun run check: 678 passing tests, zero failures, lint/format/types and
  build/smoke passed. Existing demo listener-limit/React act warnings remain.
- Read-only review and targeted follow-ups are clear after regression-tested fixes
  for stale gestures, temporary boundary disablement, buffered refocus, and mixed
  secondary/primary reports. No deferred findings.
- The user accepted this core checkpoint and requested three components-demo
  examples: fitting content, manual Unicode overflow, and browsable ToggleGroup
  reveal. The separately approved demo plan is
  [2026-10-14-horizontal-scroller-demo.md](../plans/2026-10-14-horizontal-scroller-demo.md).
- Demo-only composition and tests are delivered; the core component/callers remain
  unchanged. Final demo verification passed 680 tests and build/smoke. Read-only
  review's narrow-resize test gap was corrected and reverified. Demo human
  verification remains pending.
- All prior staged/unstaged work is preserved; follow-up changes are unstaged and
  uncommitted. No further migration phase work has begun.
