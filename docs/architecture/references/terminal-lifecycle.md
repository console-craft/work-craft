# Terminal lifecycle and recovery

Read the [overview](../overview.md) for the system model and
[ownership reference](ownership.md) for source locations. This document covers
current runtime contracts, operating safeguards and known limitations.

## Live terminal output

The daemon's [`RuntimeRegistry`](../../../packages/server/src/terminal/runtime.ts)
owns PTYs, shell PIDs, parser lifetime and runtime generations. Output is appended
to bounded pane history and fed to the daemon-owned native parser. Only the daemon
sends emulator query replies to the child; replies are not physical user activity.

The TUI receives output notifications and requests portable cell/cursor material
over its attached socket. `terminal-viewport.tsx` coalesces refreshes at 33 ms with
one abortable material request per pane. `terminal-material.ts` draws explicit
positions and styles; it does not parse ANSI. Structural changes use the root
control subscription; ordinary terminal output/material refresh does not.

The client store recovers retained pane output with at most four concurrent
abortable history requests. Recovery is scoped to connection, attachment,
navigation, epoch and runtime; completion is published even without new bytes.
The picture can remain visible during recovery without permitting early input.

## Shared terminal dimensions

[`application/sizing.ts`](../../../packages/server/src/application/sizing.ts)
elects the latest-active eligible viewer for each tab, across sessions. Attachment
and user input count as activity; idle resize, output and programmatic focus do
not. An owner's resize changes the canonical grid immediately. Other viewers
update their candidate viewport only. Covered/unusable viewers withdraw; without
an eligible viewer, the last usable grid is retained.

The daemon records geometry before applying the PTY/parser resize. Clients draw
the same canonical picture: smaller local viewports crop/follow its cursor;
larger ones show unused background. Local layout and stopped-history scrolling
never independently resize the child.

## Input and readiness

Read access to stopped material is separate from permission to write to a live
child. Three client-side gates must agree, followed by daemon revalidation:

1. **Store:** current attachment/epoch/navigation/per-tab geometry/runtime scope,
   item ancestry, archival state, pane process status and active layout.
2. **Shell:** unobscured usable presentation, dialog/drawer/resize gates and
   protected exact-destination entry/restart operations.
3. **Leaf:** actual measured dimensions and a presented current-scope picture.
   A terminal needs a 20-column by five-row viewport for input or stopped browsing;
   the explicit Reactivate action needs a 20-column by four-row pane.

The global geometry sequence orders updates; it is not interchangeable with
per-tab authorization generations or output byte cursors. Old pictures, recovered
bytes and historical terminal queries cannot acquire a fresh input sender.

[`terminal-input.ts`](../../../packages/tui/src/workbench/terminal-input.ts)
captures each input's original authority/sender, payload and finite received-output
frontier. Later output cannot extend that frontier. Pending and in-flight input
share an 8-MiB budget, charging payload plus 128 bytes per descriptor. Scope
replacement/unmount cancels retained work. FIFO acknowledgement means native PTY
buffer drain, not that the child application processed the command. An authorized
focused leaf can retain physical focus while synchronizing without forwarding
input early.

The server validates actual socket/attachment scope for reads and writes,
including after asynchronous reconstruction. Client checks do not replace that
trust boundary. Slow streams are disconnected at the bounded queue limit.

## Durable history and restart behavior

History belongs to the pane, not a shell generation. By default
[`history.ts`](../../../packages/server/src/terminal/history.ts) retains 1 MiB of
raw output per pane, flushing at 32 KiB or a 100-ms interval. A bounded timeline
keeps up to 1,024 resize/runtime-start markers. Exceeding either retention budget
explicitly truncates earlier replay with a reset/notice. Power loss can lose the
last unflushed batch, not previously committed records.

| Event                                | Behavior                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client quits/reconnects              | Same daemon and shells remain; recover display without respawn or another separator.                                                                      |
| Shell exits or fails                 | No automatic retry loop. Final picture and retained scrollback remain read-only; typing/paste never restart it.                                           |
| Daemon restarts                      | Previously running/starting/interrupted panes receive a restart separator and one fresh-shell recovery attempt. Already exited/failed panes stay stopped. |
| Explicit Reactivate / `pane restart` | One admitted restart starts a fresh shell below `[work-craft: shell restarted manually]`, preserving pane identity and bounded history.                   |

Cold recovery replays bytes and resize/runtime boundaries in disposable parsers,
captures inert styled display, and initializes a distinct fresh parser before
starting the new child. Old modes, partial escape sequences and query replies do
not leak into the fresh shell. Work Craft restores useful display and shells,
**not arbitrary Unix process memory or editor/application sessions**.

Stopped runtimes release their PTY and live parser after final drain. Older
scrollback is reconstructed lazily through a single daemon-wide display-only
cache, sharing a finite 128-request lane with start preparation. Switching between
stopped panes may rebuild it. Each client owns its own scroll offset; historical
grids are cropped rather than rewritten by viewer resizing. Reactivation resets
local scrolling to the fresh runtime and waits for old PTY drain before advancing
the generation.

New tabs start at the item's path. A split without `--cwd` samples the owned
shell's live directory, not a foreground child's private cwd. Linux uses
`/proc/<shell-pid>/cwd`; macOS uses a one-second/64-KiB bounded `/usr/sbin/lsof`
probe. Explicit CLI cwd is resolved relative to the calling CLI. Invalid or
unavailable cwd rejects before adding a pane. Successful splits equalize shares
in their tab while preserving existing processes/output.

## Local state and safe operation

[`daemon/paths.ts`](../../../packages/server/src/daemon/paths.ts) resolves the
state directory in this order:

1. `WORK_CRAFT_HOME` when set.
2. `$XDG_STATE_HOME/work-craft` when `XDG_STATE_HOME` is set.
3. `~/.local/state/work-craft` otherwise.

It contains `work-craft.sqlite`, `work-craft.sock` and `daemon.lock`. The socket is
owner-only (`0600`); exclusive daemon ownership is scoped to that home. Use a
separate home for experiments and the same home for clients intended to share a
daemon. `work-craft daemon stop` stops managed runtimes cleanly and preserves
records/history.

Schema 6 migrates schemas 4/5 without destructive reset, preserving resource IDs,
layouts, policies and output; it adds durable session navigation and internal
history boundaries. Earlier incompatible schemas are rejected, and migration
failure rolls back. Mixed-version clients/daemons are unsupported: stop the old
daemon and restart clients coherently. Startup never silently discards data.

**`daemon destroy --force` stops managed runtimes and deletes persisted Work Craft
state for the selected home.** Before using it:

1. Close reconnecting/watch clients.
2. Confirm the concrete state directory/database and runtimes to be stopped.
3. Set `WORK_CRAFT_HOME` explicitly and use a compatible executable.
4. Run the destructive command only after deciding to discard those records.

Destruction reaps managed terminals before removing the database/sidecars. It
never deletes registered directories, source work or Git metadata. Do not delete
the entire state directory or manually remove a live daemon's socket/lock.

## Known limitations and unresolved risks

- Display reconstruction keeps the native 10,000-line scrollback,
  2,097,152-cell drawing budget and 8-MiB transcript ceiling. Unsupported or
  over-budget capture fails the scoped read/start explicitly while preserving
  durable bytes. Legacy bytes without geometry cannot recover unknown old sizes.
- Native pastes above 1 MiB fail explicitly. Highly varied material can exceed
  the 8-MiB material/envelope budget and report a scoped error; ordinary supported
  dimensions have not been reduced to conceal this limit.
- Regional-indicator spacing, hyperlink destinations and invisible-wide-cell
  fidelity are unsupported. Despite narrow regional-indicator glyphs, following text
  must retain its native column positions; the spacing defect is not permission to
  shift subsequent cells. Native mode 2048 is reported unsupported because the
  emulator advertises in-band resize reports it does not emit; applications use
  ordinary terminal resize signals instead.
- Repository identity is path-based, not an incarnation ID. Moved worktrees can
  leave unavailable entries; discovery never retargets or merges live terminals.
  Bare repositories are plain-directory targets. Linked worktrees backed only by
  bare repositories and separate-git-dir layouts without a registered primary
  checkout are rejected rather than guessed.
- Bun 1.4.3 can deadlock macOS PTY exit: its event-loop wait blocks the output
  drain that lets the child finish exiting. The Bun 1.4.4 pin includes upstream's
  off-thread reaping fix. Three failed-reactivation cases remain skipped on macOS
  pending separate quarantine-removal verification.
  The [investigation spec](../../specs/2026-10-23-native-pty-exit-hang.md)
  contains evidence, a bounded reproduction requiring an external watchdog and
  revisit criteria. Do not remove the quarantine based on a single passing run.
- Physical-terminal visual/focus behavior, Linux live-cwd behavior and long-running
  listener stability are not certified by a macOS check. See
  [verification](development.md#checks-and-test-execution) for automated coverage
  and manual diagnostics; a passing gate is not a performance/fidelity guarantee.
