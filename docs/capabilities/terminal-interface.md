# Terminal interface, focus and client boundaries

Terminal reading path — **2 of 2** · Previous:
[Persistent terminals](persistent-terminals.md) · [Overview](../overview.md)

**The TUI owns interaction and presentation, never durable work or process
lifetime.** React composes OpenTUI renderables; a disposable client store supplies
daemon state. Local focus, browse candidates and pending UI intent are separate
from the daemon's shared session selection.

## Composition and ownership

| TUI capability | Responsibility                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `client/`      | Connection, attachment, control synchronization, live authority and pane-local output publication               |
| `input/`       | Pure keyboard interpretation, command metadata and spatial-focus rules; no RPC execution                        |
| `shell/`       | Compose capabilities, route actions, submit commands, manage dialogs/focus/errors and coordinate terminal entry |
| `navigation/`  | Category/item projections, filtering, expansion, browse candidates and path labels; no Git discovery            |
| `workbench/`   | Tabs, split geometry, stable pane leaves, material requests, input queues and native readiness                  |
| `ui/`          | Application-independent primitives, controls, components, interaction mechanisms and themes                     |

`main.tsx` registers `TerminalMaterialRenderable` and creates the renderer.
`App` selects the default theme and composes `useWorkCraft()` with `WorkCraftShell`.
Controls/components demos are alternate entry-point views, not another application
or a persisted theme preference.

The [lint configuration](../../packages/tui/.oxlintrc.json) enforces direct `@/`
internal imports, the public `@work-craft/server/client` boundary (plus the inert
`client/output-probe` recorder), and no production imports of test support.
`client`, `input`, `navigation` and `workbench` cannot import `shell`; reusable `ui`
cannot import application capabilities or demos. The shell composes downward.
Theme contracts/providers remain in `ui/theming/`.

## Keyboard, focus and asynchronous entry

The command router interprets host shortcuts and leader sequences. The shell
combines routing with actual native focus, command availability, dialog state and
live connection scope. Unhandled terminal input becomes semantic events for the
daemon's parser; reusable controls retain their own text/editing behavior.

Four identities must not be conflated:

1. The local navigator's highlighted candidate.
2. The daemon's selected item/tab/pane for the attached session.
3. The client's logical/native focus target.
4. The exact destination of a pending open/create/split/restart operation.

Terminal entry waits for the command's committed revision in the same epoch, the
active intended destination, usable geometry and a presented current-scope frame.
New input, focus or navigation can cancel an obsolete entry. Split/restart/tab
creation cannot fall back to a convenient running sibling. Restart submission
protection remains until its authoritative response revision is observed even if
the pending focus transfer was canceled.

Native events may arrive before React commits. Captured callbacks therefore read
live store state and synchronous intent refs instead of trusting an old rendered
projection. Layout effects, native measurement callbacks and frame listeners are
part of the synchronization mechanism, not interchangeable render timing details.

## Rendering is not authority

Pane output has independent subscriptions outside the root React control
subscription. `TerminalViewport` coalesces material refreshes at 33 ms with one
abortable request per pane. The returned styled cell/cursor picture is drawn at
explicit positions; the client does not parse ANSI.

Input forwarding needs all of the following, followed by daemon revalidation:

- Store authority: connected current attachment, epoch/navigation/tab geometry,
  correct item ancestry/layout/runtime and a running selected pane.
- Shell eligibility: unobscured usable presentation, no blocking dialog/drawer or
  resize guard, and no conflicting entry/restart operation.
- Native leaf readiness: measured dimensions and a current-scope picture actually
  presented by a native frame, not merely received by JavaScript.

A terminal viewport needs at least 20 columns by five rows for input or stopped
browsing; Reactivate needs a 20-column by four-row pane. Input captures its original
sender and a finite received-output frontier. Later output cannot extend that
frontier indefinitely. Pending and in-flight events share an 8-MiB budget with
128 bytes charged per descriptor. Scope replacement/unmount cancels queued work.
FIFO acknowledgments indicate PTY buffer drain, not application-level execution.

The shell may retain a coherent same-session body while reconnecting. That is
presentation only: commands, viewport reports and input continue using live
authority. Pane IDs and keyed ancestry preserve terminal identity across geometry
changes; runtime/epoch replacement deliberately gives the terminal a new identity.

## Layout, overlays and errors

Below 80 columns the shell blocks normal interaction with a resize guard. At 120
columns and above, an open navigator docks; at narrower usable widths it becomes
a covering drawer. Covered viewers withdraw from size election and terminal input.

Application dialogs/guards reserve the **bottom one-row status bar** rather than
covering or dimming it. Reusable dialog components retain full-screen defaults;
the application supplies its own bottom margin. Field validation remains beside
the field, operational errors appear as source-labelled status messages, and
child stderr remains terminal output. Reporting must not steal focus or unmount
unrelated panes.

## CLI boundary

The CLI parses arguments without interactive prompts and uses the same daemon
commands over HTTP. Explicit cwd/registration paths resolve in the calling
process. Results are plain text or `--json`; usage errors exit 2 and runtime/API
errors exit 1. Even `daemon status` ensures the daemon is running, so it is not a
passive filesystem-only liveness probe. Interactive input remains a WebSocket/TUI
responsibility.

## Code References

- [shell.tsx](../../packages/tui/src/shell/shell.tsx),
  [use-shell-focus.ts](../../packages/tui/src/shell/use-shell-focus.ts) and
  [use-terminal-entry.ts](../../packages/tui/src/shell/use-terminal-entry.ts):
  application composition, live gates and exact-destination entry.
- [command-router.ts](../../packages/tui/src/input/command-router.ts): host routing
  and hint definitions; [state.ts](../../packages/tui/src/shell/state.ts): disposable UI state.
- [surface-view.tsx](../../packages/tui/src/workbench/surface-view.tsx) and
  [terminal-pane.tsx](../../packages/tui/src/workbench/terminal-pane.tsx): stable
  leaves, runtime identity and stopped actions.
- [terminal-viewport.tsx](../../packages/tui/src/workbench/terminal-viewport.tsx),
  [terminal-input.ts](../../packages/tui/src/workbench/terminal-input.ts) and
  [terminal-material.ts](../../packages/tui/src/workbench/terminal-material.ts):
  material/readiness, bounded captured input and native drawing.
- [layout.ts](../../packages/tui/src/shell/layout.ts) and
  [dialog-overlay.tsx](../../packages/tui/src/shell/dialog-overlay.tsx): responsive
  dimensions and application status-row reservation.
- [CLI main.ts](../../packages/cli/src/main.ts) and
  [args.ts](../../packages/cli/src/args.ts): executable command surface and exit behavior.

Terminal reading path — **2 of 2** · Previous:
[Persistent terminals](persistent-terminals.md) · [Overview](../overview.md)
