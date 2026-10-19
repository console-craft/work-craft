# TUI Component Adoption Phase 2: Dialogs And Forms

## Coding Implementation Checkpoint (2026-10-16)

Creation continues using Dialog/Field/Input/Button. Coding registration has one Path field and Register action; Archive confirms the captured item/path and states that terminals keep running. Server field attribution stays inline, while operational failures use central status and preserve native input/focus. The resize guard suspends DialogContent visibility without unmounting form state. This is a concrete caller update, not a new dialog API or adoption phase; human acceptance remains pending under the Coding spec.

## Later Error-Presentation Amendment

Phase 2 and its verification records below remain accepted history. The accepted
[Coding Navigator/error policy](./2026-10-15-coding-navigator-design.md) now changes
the target error-placement rules: field-specific client/server validation stays
inline, while other Work Craft failures report in the source-labelled status bar.
The updated form requirements below describe that target, not a claim that the
previous Phase 2 code already implements it. Focus, input retention, cancellation,
and the status-safe overlay margin remain unchanged.

## Goal And Boundary

Adopt the existing Dialog, Command, and Field components for session selection
and creation forms. This implements Phase 2 of the
[component-adoption roadmap](./2026-10-13-tui-component-adoption-design.md), not
Stage 2 Shared Session Navigation of the architectural overhaul.

Keep React/OpenTUI, Bun, the normal entrypoint, and current capability ownership.
Do not change durable state, daemon commands, terminal lifecycle, or later phases.
Keep the user's staged Phase 1 changes intact; leave new work unstaged.
If an intended library component cannot satisfy a required behavior, explain the
limitation and agree on a solution with the user before implementing a substitute
or extending its API. Do not silently retain custom presentation as a workaround.

## Agreed Components And Behavior

- Use controlled Dialog and DialogContent with DialogHeader, DialogTitle,
  DialogDescription where useful, and DialogFooter for actions.
- Accept standard library dimensions, backdrop treatment, background/root focus,
  and primary-button release activation. Do not reproduce the old 60% frame or
  add options merely to preserve displaced styling.
- DialogContent owns the one modal focus scope. The shell's existing keyboard
  policy uses the modal registry for focus repair and Tab traversal. Do not mount
  an additional FocusManager keyboard listener or keep a competing shell scope.
- Application overlays must leave the status bar uncovered and undimmed. The
  shared shell DialogOverlay uses `overlayMargins={{ bottom: 1 }}`; DialogContent
  supports optional cell margins on every edge but remains full-screen by default.
  Both backdrop and content stay inside that area, including after resize. With
  no drawable area left, hide the overlay without discarding its dialog state.
- Use Command, CommandInput, CommandList, CommandItem, and CommandEmpty for the
  chooser, following the Dialog + Command example in `demos/components.tsx`.
- Use standard case-insensitive substring filtering and `direction="up"`: results
  appear above the search input, with the bottom-most enabled match highlighted.
  Do not extend Command to restore the previous cursor or highlight the attached
  session initially. Query and highlight remain component-local and reset on a
  fresh chooser mount.
- Keep sessions ordered by position and ID. Each CommandItem filters by session
  name and attaches its stable session ID only through onSelect. Typing, filtering,
  hovering, and browsing must not attach a session.
- Focus the search input when sessions exist. With no sessions, initially focus
  New session. Keep New session outside filtered results so it is always reachable.
- Use `No sessions yet.` for an empty installation and `No matching sessions.`
  when an existing session list has no query matches.
- Use Field, FieldLabel, Input, and FieldError for creation, with Create and Cancel
  actions in DialogFooter. Preserve the `New <kind>` title and existing name
  trimming/empty-name validation. Input Enter and Create use the same submission
  path; the button reads the live native input value, not a potentially stale
  rendered prop.
- Empty or whitespace-only submissions show `Name is required.` inline without
  sending a durable command. Editing clears this local validation message; server
  validation specifically attributed to a field also uses FieldError.
- Other command/API failures report in the source-labelled status bar while
  preserving entered text, the open dialog, and eligible focus. Do not put generic
  server errors in FieldError, duplicate full messages, or add a toast system.

## Chooser Creation Shortcut

In the session chooser, Ctrl+Space starts a leader sequence and plain n completes
it to open New session through the existing context.create semantic action.
Unprefixed n, j, k, g, and Space remain ordinary search input. Arrow keys and
Command's Ctrl+n/Ctrl+p navigation continue to browse matches.

This is a narrow exception to the previous prohibition on dialog leader mode:

- Only the session chooser enables this sequence. Creation forms do not enable
  shell leader mode.
- No shell split, pane, item, navigation, or other background leader action is
  enabled under a modal. The outside-dialog leader+n item action is unchanged.
- Reconnect and quit remain the only modal-eligible global chords.
  They remain available while the chooser leader prefix is pending.
- Ctrl+C keeps the focused input's standard clearing behavior; it is not an
  invalid leader continuation or a dialog-dismissal action. If a chooser prefix
  is pending, clear that prefix and let the input handle Ctrl+C. Do not change
  existing Ctrl+C behavior when the input is already empty.
- Escape follows the normal dialog cancellation policy, even during a pending
  chooser prefix. It requests dismissal and clears the prefix; it does not
  require a second Escape to close a cancellable dialog. Startup safeguards
  below still apply.
- An unrecognized continuation is consumed and reports the existing invalid
  leader error; it must not enter search text or execute a background action.
- Opening/replacing/closing a dialog clears its pending sequence. Router state
  advances synchronously between buffered native keys.
- Hints advertise leader+n for creation, never a standalone n. Prefix-mode hints
  include only eligible chooser continuations, not background shell commands.

## Cancellation And Focus

The shell remains authoritative for dialog state and cancellation policy;
controlled Dialog closure requests call that policy.

- The initial chooser cannot close before a session is attached, including via
  Escape, backdrop, or a close control. Omit Cancel in that state.
- Cancelling initial session creation returns to the chooser; it does not expose
  background shell content.
- With an attached session, cancelling a form or chooser closes it and restores
  the initiating target when valid, otherwise the existing shell fallback.
- Dialog replacement focuses the appropriate search/name/create control. Valid
  focus survives data refresh. Removed or disabled targets use library repair.
- Tab/Shift+Tab wraps within the active modal; background header Tab traversal
  cannot run under it. Missing transitional modal content must not forward input
  to a retained terminal.
- Preserve inactive terminals, history, replay, and native input identity across
  all dialog transitions. Disconnects still disable durable mutations without
  discarding the last coherent snapshot or form input.

## Scope Of Cleanup

Remove displaced custom overlay framing and the shell-owned modal scope. Remove
the old session browsing cursor props/state/projection and their fixtures once
Command owns browsing. Keep application resource selection separate from its
local command highlight. Do not introduce a generic modal framework, new command
IDs solely for this shortcut, or library APIs without a concrete missing need.

## Verification And Checkpoint

Use focused router and behavioral render tests for filtering/activation, local
text input, chooser-only leader+n, startup cancellation, empty/no-match states,
modal focus repair, buffered keys, hints, and inline errors. Retain real entrypoint
and PTY coverage for terminal passthrough and process preservation. Update tests
for approved component defaults rather than reproducing old geometry or Select
internals. No broad visual snapshots.

Run a fresh bun run check and a read-only whole-change review. Stop for human
verification of session search, attachment, creation by button/leader+n, form
submission/cancellation, errors, mouse/backdrop behavior, and terminal focus
restoration before Phase 3.

## Status

Product/component decisions and the implementation plan are approved. Phase 2
is implemented with controlled Dialog, searchable Command, and Field-based
creation forms; standard directional behavior needs no library API changes.
The affected router, render, and real-entrypoint tests pass.
The latest `bun run check` passed: 610 tests, lint, formatting, types, compilation,
and compiled smoke. Independent review found one modal Tab/leader ordering issue;
both Tab directions were reproduced and fixed with same-buffer regression tests.
There are no deferred review findings. The smoke assertion was updated for the
approved library backdrop. Existing listener-limit and React act warnings remain.
Changes remain unstaged, preserving the user's staged Phase 1 baseline byte for
byte. Human verification is required before Phase 3; no later-phase work began.

Human verification follow-ups add required-name feedback for empty/whitespace-only
submissions and upward Command direction (input below results). Both follow-ups
are covered by regression tests and the final full check above; manual verification
remains with the user.

The status-bar overlay follow-up also passed the full check above. Independent
read-only review found no issues with overlay margins, clipping, exhausted areas,
pointer behavior, or focus/state retention. Library defaults and demo-only overlays
remain unchanged; all current production dialogs use the shared shell margin.
