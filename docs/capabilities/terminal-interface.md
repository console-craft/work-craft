# Terminal interface, focus and client boundaries

Terminal reading path — **2 of 2** · Previous:
[Persistent terminals](persistent-terminals.md) · [Overview](../overview.md)

**The TUI owns interaction and presentation; the daemon owns saved work and
process lifetime.** React composes OpenTUI views around a disposable client store.
A highlighted browse candidate, shared session selection and local keyboard focus
are separate states. A terminal accepts input only when current permission, the
intended destination and a displayed terminal picture agree.

## Composition and ownership

`main.tsx` registers `TerminalMaterialRenderable` and creates the OpenTUI renderer.
`App` selects the default theme and gives `useWorkCraft()` state to
`WorkCraftShell`. Controls/components demos are alternate entry-point views, not
another application or a saved theme preference.

```text
native key/paste/pointer event
               |
      shell policy + input router
          /                  \
 local focus/draft       application command
          |                      |
  client reducer          public client -> daemon
          |                      |
          +------ rendered views <--- control state
                             |
                   workbench stable pane leaves
                             |
                   pane-local picture and input
```

The shell combines the header/session controls, workspace bar, category rail,
navigator, workbench, overlays and status row. Its capability owners have distinct
responsibilities:

- **`client/`:** connection, session attachment, control synchronization, live
  permission checks and pane-local output publication.
- **`input/`:** keyboard interpretation, command metadata and spatial focus rules.
  It does not call the daemon.
- **`shell/`:** compose capabilities, submit commands, manage dialogs/focus/errors
  and coordinate entry into the intended terminal.
- **`navigation/`:** category/item views, filtering, expansion, browse candidates
  and path labels. Git discovery remains server-owned.
- **`workbench/`:** tabs, split geometry, stable pane leaves, terminal picture
  requests, input queues and readiness to receive input.
- **`ui/`:** reusable primitives, controls, components, focus mechanisms and themes
  that do not depend on application capabilities.

The [lint configuration](../../packages/tui/.oxlintrc.json) enforces direct `@/`
internal imports, the public `@work-craft/server/client` boundary (plus the inert
`client/output-probe` recorder), and no production imports of test support.
`client`, `input`, `navigation` and `workbench` cannot import `shell`; reusable `ui`
cannot import application capabilities or demos. The shell composes these owners.
Theme contracts/providers remain in `ui/theming/`.

## Keyboard, focus and asynchronous entry

The router interprets host shortcuts and leader sequences. The shell combines
that interpretation with actual native focus, command availability, dialogs and
live connection state. Unhandled terminal input becomes semantic events for the
daemon parser to encode; reusable controls keep their own text-editing behavior.

Four states answer different questions:

1. **Browse candidate:** which navigator row is highlighted locally?
2. **Shared selection:** which item/tab/pane did the daemon select for this session?
3. **Logical/native focus:** which region or OpenTUI view receives this client's keys?
4. **Pending destination:** which exact pane should receive focus after an
   open/create/split/restart command completes?

Activating a browse candidate sends `session.openItem` and creates a pending
terminal-entry intent. Creating a tab, splitting or restarting also retains an
intent, but these operations must enter the exact pane identified by their
command response. The entry coordinator waits for:

1. The response's destination IDs and committed revision.
2. A snapshot in the same **epoch** (daemon lifetime) that reaches that revision,
   with the expected session/item/tab/pane still active.
3. Usable measured dimensions and a current terminal picture that a native frame
   has actually displayed.
4. The intent to remain current and its focus origin to remain eligible.

A running sibling is never a substitute for a failed or still-starting split or
restarted pane. New input, focus or navigation can cancel old entry. Closing the
entry's own form or drawer may transfer its focus origin; unrelated state cannot
revive it. Restart submission protection remains until the response revision is
observed, even if the user canceled the pending focus transfer.

### Example: the snapshot arrives before the command response

A tab-create command commits, and its snapshot arrives while the response is
still delayed. The shell can show the new tab and follow the selection change,
but the snapshot cannot supply the response's exact pane IDs for entry. When the
response arrives, the coordinator checks those IDs and waits for that pane's
measured and displayed picture. If the response arrives first, it waits instead
for the snapshot and presentation to catch up. Neither order permits entry into
a convenient sibling.

Native events can arrive before React commits. Captured handlers therefore read
live store state and synchronous intent refs instead of relying on the last
rendered view. Layout effects, measurement callbacks and frame listeners preserve
these ordering boundaries; a generic render flush cannot replace them.

## Display continuity does not carry permission

**Material** is the daemon's portable picture of styled cells and cursor. The TUI
draws it at explicit positions without parsing ANSI. Output has pane-local
subscriptions outside the root React control subscription. `TerminalViewport`
coalesces refreshes at 33 ms with one abortable material request per pane.

A request's **scope** identifies its current connection, session selection, grid
and shell. Input needs three client checks, followed by daemon revalidation:

- **Store:** connected current attachment, matching epoch/navigation/grid/runtime,
  valid item ancestry/layout and the selected running pane.
- **Shell:** usable unobscured display, no blocking dialog/drawer or resize guard,
  and no conflicting entry/restart operation.
- **Leaf:** measured dimensions and a current-scope picture actually displayed by
  a native frame, not just received by JavaScript.

A terminal viewport needs 20 columns by five rows for input or stopped browsing;
Reactivate needs a 20-column by four-row pane. Input captures its original sender
and a finite version of received output when the event arrives. Later output
cannot extend that waiting point indefinitely. Pending and in-flight events share
an 8-MiB budget, charging 128 bytes per descriptor in addition to payload. Changing
scope or unmounting cancels queued work. FIFO acknowledgments mean PTY buffer
drain, not execution by a shell/editor.

`projectShellPresentation` can keep a coherent same-session body during reconnect.
It does not carry that display across a different requested session or an
unconfirmed new epoch. Commands, viewport reports and input still consult live
state. [Client synchronization](../foundations/client-synchronization.md) owns
these identifiers and permission checks.

Pane IDs and keyed ancestors preserve view identity across geometry changes. A
new shell generation or daemon epoch deliberately replaces local terminal state.
Mounting or unmounting a React view does not own PTY, parser or history lifetime.

## Layout, overlays and errors

Below 80 columns the shell blocks normal interaction with a resize guard. At 120
columns and above, an open navigator docks; at narrower usable widths it becomes
a covering drawer. Covered viewers withdraw from size election and terminal input.

Application dialogs/guards reserve the **bottom one-row status bar** instead of
covering or dimming it. Reusable dialogs keep full-screen defaults; the application
supplies its own bottom margin. Field validation stays beside the field,
operational errors appear as source-labelled status messages, and child stderr
stays terminal output. Reporting must not steal focus or unmount unrelated panes.

## CLI boundary

The CLI parses arguments without prompts and uses the same daemon commands over
HTTP. Explicit cwd/registration paths resolve in the calling process. Results are
plain text or `--json`; usage errors exit 2 and runtime/API errors exit 1. Even
`daemon status` ensures a daemon is running, so it is not a passive filesystem
liveness check. Interactive input remains a WebSocket/TUI responsibility.

## Code References

- [shell.tsx](../../packages/tui/src/shell/shell.tsx) (`WorkCraftShell`): application
  composition, live/read/display state and viewport reports.
- [use-shell-commands.ts](../../packages/tui/src/shell/use-shell-commands.ts),
  [use-shell-focus.ts](../../packages/tui/src/shell/use-shell-focus.ts) and
  [use-terminal-entry.ts](../../packages/tui/src/shell/use-terminal-entry.ts):
  command protection, focus and exact-destination entry.
- [terminal-entry.ts](../../packages/tui/src/shell/terminal-entry.ts)
  (`entryRevisionReady`, `entryPaneCandidates`): revision and destination checks.
- [command-router.ts](../../packages/tui/src/input/command-router.ts): key routing
  and hints; [state.ts](../../packages/tui/src/shell/state.ts): local UI state.
- [presentation.ts](../../packages/tui/src/shell/presentation.ts)
  (`projectShellPresentation`): same-session reconnect display.
- [surface-view.tsx](../../packages/tui/src/workbench/surface-view.tsx) and
  [terminal-pane.tsx](../../packages/tui/src/workbench/terminal-pane.tsx): stable
  leaves, shell identity and stopped actions.
- [terminal-viewport.tsx](../../packages/tui/src/workbench/terminal-viewport.tsx),
  [terminal-input.ts](../../packages/tui/src/workbench/terminal-input.ts) and
  [terminal-material.ts](../../packages/tui/src/workbench/terminal-material.ts):
  picture/readiness, captured input queue and native drawing.
- [layout.ts](../../packages/tui/src/shell/layout.ts) and
  [dialog-overlay.tsx](../../packages/tui/src/shell/dialog-overlay.tsx): responsive
  dimensions and application status-row reservation.
- [CLI main.ts](../../packages/cli/src/main.ts) and
  [args.ts](../../packages/cli/src/args.ts): commands and exit behavior.

Terminal reading path — **2 of 2** · Previous:
[Persistent terminals](persistent-terminals.md) · [Overview](../overview.md)
