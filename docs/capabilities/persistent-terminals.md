# Persistent terminals and recovery

Terminal reading path — **1 of 2** · [Overview](../overview.md) · Next:
[Terminal interface](terminal-interface.md)

**A pane is durable; its shell process and parser are not.** The daemon owns PTYs,
shell PIDs, native parsers and runtime generations. A reconnecting client uses the
same running process. A daemon restart reconstructs bounded display and starts a
new shell for eligible interrupted panes; it cannot restore arbitrary process memory.

## Process and output lifecycle

`RuntimeRegistry.start` admits one start per pane, waits for a prior runtime's
final PTY drain, advances the generation and validates its saved shell/cwd. It
then creates a parser and Bun PTY process. Status progresses through `starting`
and `running` to `exited`, or to `failed` if preparation/spawn fails.

```text
PTY bytes -> daemon native parser -> portable styled cell/cursor material
       |              |
       |              +-> child query replies -> same PTY
       +-> bounded history + pane output notifications -> clients

client semantic key/paste/mouse/focus -> scope validation
       -> daemon parser encodes current terminal modes -> PTY drain acknowledgment
```

The daemon alone replies to child terminal queries. Emulator replies do not count
as physical user activity. The TUI never replays historical queries into a live
child. Material reads and semantic input are scoped by the
[synchronization protocol](../foundations/client-synchronization.md).

When a process exits, the daemon waits for final output, captures its last frame
and releases the live parser/PTY resources. The retained last picture remains
readable; older scrollback is reconstructed on demand. Failed reactivation can
retain the previous final picture. There is no automatic shell-exit retry loop.

## History and restart semantics

History belongs to a pane across runtime generations. Defaults retain 1 MiB of raw
output per pane and at most 1,024 resize/runtime-start markers. Output is queued
for transactional flush at 32 KiB or after 100 ms; timer-triggered flush failures
leave queued data available for a later retry. A crash can lose unflushed output.
This is a bounded transcript, not an audit log or event store.

Byte cursors, initial geometry, resize ordering and explicit `fresh`/`restored`
runtime boundaries are retained together. Exceeding byte or marker retention
advances the replay baseline and exposes truncation with a reset/notice.

| Event                                 | Result                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Client quits, reloads or reconnects   | Existing shell/parser remain; client display is recovered                                                    |
| Shell exits                           | Read-only final display/history; typing and paste do not restart it                                          |
| Daemon restarts                       | Previously `running`, `starting` or `interrupted` panes get a separator and one fresh-shell recovery attempt |
| Pane was already `exited` or `failed` | Remains stopped across daemon restart                                                                        |
| Explicit Reactivate / `pane restart`  | Start a fresh shell in the same pane, preserving bounded history and adding a manual-restart separator       |

Recovery replays bytes and geometry in disposable parsers with no child attached.
It drains/discards historical responses, converts the result into an inert styled
display transcript and initializes a distinct fresh parser. Old terminal modes,
partial escape sequences and input protocols must not leak into the fresh child.

Stopped-history reconstruction has one daemon-wide display-only cache and a
128-request lane shared with start preparation. Switching between stopped panes
can rebuild the cache. Per-client scroll offsets do not resize historical grids;
starting a new runtime resets local scrolling.

## One canonical grid across viewers

Each tab elects its latest-active eligible viewer across all sessions. Attachment
and physical activity advance election order; passive resize, output and
programmatic focus do not. The owner's resize changes the canonical grid;
nonowners only update their candidate viewport. Covered or unusable viewers
withdraw. With no eligible viewer, the last usable size is retained.

Geometry is recorded in history and broadcast before the PTY/parser resize.
Smaller clients crop/follow the canonical cursor; larger clients show unused
background. A pane's local viewport never independently resizes its child.

## Working directory and layout

New tabs use the item's target cwd. A split without explicit cwd samples the
**owned shell process**, not a foreground editor or child process: Linux reads
`/proc/<pid>/cwd`; macOS uses a one-second, 64-KiB-bounded `lsof` probe. The runtime
identity is checked after inspection. An unavailable cwd rejects before a new
pane is added. Explicit CLI paths are resolved by the calling client.

Splitting replaces one leaf with a binary split and equalizes direction-aware
shares in the tab. Existing pane IDs, process ownership and output are preserved.
Vertical means side-by-side; horizontal means top/bottom.

## Known limitations and unresolved risks

- Native reconstruction has a 10,000-line scrollback limit, a 2,097,152-cell drawing
  budget and an 8-MiB generated transcript ceiling. Over-budget reconstruction
  fails explicitly without discarding the persisted source bytes. Missing old
  geometry cannot be recovered by inference.
- Material and stream envelopes are bounded at 8 MiB; highly varied frames can
  fail a scoped request. Native paste encoding rejects pastes above 1 MiB even
  though transport assembly allows a larger bounded transfer.
- Single regional-indicator glyphs render narrow, but following text must retain
  its native columns. Hyperlink destinations and invisible-wide-cell fidelity
  are not fully represented by the current material path. Native mode 2048 is
  explicitly reported unsupported because its advertised resize reports are not emitted.
- **Unclear:** whether the previously observed intermittent multi-client full-frame
  mismatch after cold restart is repaired. The
  [historical risk record](https://github.com/console-craft/work-craft/blob/6b7279b35f75f16baf1ae651af33f7b7b1d7c604/docs/architecture/references/terminal-lifecycle.md#known-limitations-and-unresolved-risks)
  reports removal of its acceptance case; the current code and narrower retained
  coverage do not establish an equivalent repair. Do not treat a green routine
  gate as proof of frame equality, burst throughput or input-latency guarantees.

## Code References

- [runtime.ts](../../packages/server/src/terminal/runtime.ts) (`RuntimeRegistry`):
  PTY/parser lifetime, generation checks, drain and stopped material.
- [history.ts](../../packages/server/src/terminal/history.ts) (`TerminalHistory`)
  and [history-geometry.ts](../../packages/server/src/terminal/history-geometry.ts):
  retention and atomic byte/boundary persistence.
- [cold-history.ts](../../packages/server/src/terminal/cold-history.ts)
  (`restoreColdProjection`) and
  [stopped-display.ts](../../packages/server/src/terminal/stopped-display.ts):
  isolated reconstruction and bounded shared cache.
- [projection.ts](../../packages/server/src/terminal/projection.ts): native parser,
  material extraction, semantic encoding and mode-2048 workaround.
- [sizing.ts](../../packages/server/src/application/sizing.ts)
  (`createTerminalSizing`): viewer election and canonical pane grids.
- [app.ts](../../packages/server/src/application/app.ts) (`recoverOnce`,
  `applyGeometry`) and [cwd.ts](../../packages/server/src/terminal/cwd.ts): recovery
  orchestration and source-shell cwd inspection.

Terminal reading path — **1 of 2** · [Overview](../overview.md) · Next:
[Terminal interface](terminal-interface.md)
