# Cold-history display restoration

## Status and intent

Approved by the user in this session on 2026-10-23. This implements follow-up 2 of
`../handovers/2026-10-22-unpatched-runnable-preview.md`; cleanup is complete at
`ecfe5f24255320c6a2c13e4848f772063e74355f`, with green CI run `39904008403`.

The user selected ordinary pane scrollback: retained output above a restart
separator and the fresh shell, with no separate history screen or new navigation
command. The daemon remains the sole owner of parsing, durable history, child
query replies and input encoding. Stock registry OpenTUI 0.6.6 remains unchanged.

The user also permits resetting/reseeding disposable personal development data if
needed. No reset is currently required: use owned fixtures first and identify the
exact state home before a destructive operation. This permission does not replace
restart/preservation verification or authorize replacing the installed command,
merging #41, or modifying unrelated files.

## Confirmed regression

`application/app.ts:recoverOnce` preserves retained bytes, appends a restart
separator, and starts a fresh `RuntimeRegistry` parser. It never initializes that
parser's display from retained output. The material TUI renders the fresh parser,
not the bytes returned by the existing scoped history API.

A disposable database/runtime reproduction confirmed: the old output and restart
separator survive reopening SQLite, but the recovered material contains no old
output. Existing recovery tests assert persisted bytes rather than visible cold
history. Ordinary reconnect already keeps the current daemon-owned parser.

Native API probes also confirmed:

- RIS (`ESC c`) resets input modes but clears scrollback.
- DECSTR (`CSI ! p`) keeps scrollback but leaves application-cursor and bracketed
  paste modes enabled. Replaying history followed by a soft reset is not safe.
- Growing an isolated native terminal's height brings its retained scrollback into
  the native drawing buffer; composed cursor coordinates reflect the pulled rows.
  This uses public APIs, not private parser handles or patched assets.

## Required behavior

- After a daemon restart, a recovered running pane shows retained output and one
  restart separator before its fresh shell output. Several screens remain
  accessible with the existing wheel-scroll behavior.
- The live parser begins with fresh input/query modes. Old application-cursor,
  paste, mouse, focus, keyboard, alternate-screen, margins, pending escape/parser
  state and query replies cannot become authority for the new child.
- Cold output is reconstructed presentation, not a resumed program or a terminal
  state checkpoint. Preserve supported Unicode cell positions, styles, styled
  blanks and existing truncation notices; do not claim new hyperlink/hidden-wide
  fidelity or repair the accepted regional-indicator defect.
- New live output and normal client reconnect use the existing material path.
  Reconnect does not reconstruct history or duplicate separators. Multiple cold
  restarts preserve generation isolation, including earlier explicit restarts.
- Existing exact-scope authority, finite input readiness, canonical sizing,
  generation invalidation and cleanup remain in force.
- A failed/missing shell or cwd must not destroy durable output. Recovery remains
  once-only and must not turn a display failure into an automatic restart loop.

## Approach

### 1. Isolated replay, then inert display capture

Use a temporary daemon-owned native parser to replay bounded retained bytes and
their ordered resize metadata. Drain and discard its responses after each bounded
write and resize. It has no PTY, socket callbacks, input encoding authority or
reference to the fresh child. Honor truncation-prefix bytes separately from raw
byte cursors; use the existing fallback geometry for legacy unknown dimensions.

Capture the resulting scrollback and visible rows using public native composition
and buffer leases. A small internal snapshot/serialization seam may share the
existing native cell extraction code; do not add another emulator or generalized
renderer. Capture only actually retained rows, including meaningful cells below a
saved cursor, and preserve styled blanks. Do not interpret repeated row content as
the start of history.

Serialize that material into a tightly restricted display transcript: validated
drawable graphemes, generated positioning/newline commands and generated SGR
styles only. Historical escape strings, links, mode changes, queries, cursor
styles and saved cursor state are never copied into the transcript. Position wide
cells and regional indicators explicitly rather than joining their text into new
graphemes. Finish with default presentation attributes and a deterministic cursor
at the new-shell boundary.

Destroy the temporary native resources before starting the new child. Seed a new
live parser with only this inert transcript; then spawn the shell. The existing
live parser alone handles all later output, input encoding and query replies.
The ordinary material protocol and disposable TUI need no new history-view mode.

### 2. Persist runtime boundaries, not guessed delimiters

Raw retained output may span several runtime generations. Replaying it as one
unbroken terminal stream would let earlier modes affect later generations' display
even if live authority were isolated. Do not infer trusted boundaries from the
human-readable restart separator: child output can contain the same text.

The proposed engineering choice is to record starts in the existing ordered,
bounded terminal geometry timeline. A non-destructive schema migration adds an
internal runtime-start discriminator to resize records; starts force a record
even when dimensions have not changed. Keep this internal metadata out of the
existing public history DTO and material request/response shapes.

Distinguish fresh/explicit starts from cold-restored starts so replay can reconstruct
the correct empty-screen or restored-transcript starting position. Process resets
and resizes in the same sequence order, including multiple events at one byte
cursor. At a runtime boundary, retain the previous generation only as inert
display, discard its entire parser state and replies, and begin the next segment
with fresh modes. The current cold boundary owns its persisted restart separator,
so it is displayed exactly once, not appended again on each client connection.

Record boundaries before any output of their runtime can be persisted. Preserve
the current recovery ordering that commits interruption metadata and the restart
separators before spawning recovered shells. Existing migration-era history has no
trustworthy historical start markers: treat it as one legacy display-only segment,
never invent boundaries and never grant it live authority.

### 3. Resource and failure policy

- Keep the existing one-MiB byte retention and 1,024-entry geometry timeline bounds;
  runtime boundaries share the metadata budget and its explicit truncation policy.
- Keep 10,000 native scrollback lines, the existing two-million-cell native drawing
  context budget and eight-MiB material/transcript budgets. Do not increase limits
  to accommodate restoration.
- Replay/capture one pane at a time and release its temporary resources before
  allocating the next. No persistent second parser or unbounded history cache.
- Capture in bounded pages, grow only as needed, and check allocation/output budgets
  before materializing large arrays/strings. Do not allocate a maximum-sized blank
  history screen for every pane or silently drop rows to fit a new smaller limit.
- Historical unsupported/over-limit display must fail explicitly and leave durable
  bytes available. Define a scoped recovery error rather than silently marking an
  incomplete display restored. Cleanup applies on success, parse/capture errors,
  missing executable/cwd, spawn failure and daemon shutdown.

## Ownership and change reach

- `server/src/terminal/`: isolated replay/capture, live parser seeding, and bounded
  history/geometry boundary tracking. Keep internal contracts explicit and local.
- `server/src/application/app.ts`: cold recovery ordering and passing retained data
  to runtime creation; ordinary reconnect remains untouched.
- `server/src/persistence/`: additive schema migration and preservation tests.
- `server/src/application/recovery.test.ts` and terminal-owner `tests/`: multi-screen
  display, multiple restarts, mode/query isolation, boundary ordering and failure
  cleanup tests.
- `tui/src/tests/`: actual daemon plus disposable TUI acceptance for cold output,
  wheel access across the separator, fresh input and ordinary reconnect. Reuse the
  owned temporary-home/process fixtures. Change production TUI only if a concrete
  readiness/material integration defect requires it; retain capability boundaries.
- Current README/source map: describe actual restored behavior and remaining limits.
  Keep older dated designs and checkpoints as history.

## Verification

Reproduce missing visible history before the implementation, then require passing
coverage for: several screens across daemon death/restart; Unicode/styles and
styled blanks; persisted resize order; repeated restarts and an explicit-start
boundary; retained truncation markers; old alternate/application-cursor/paste/
mouse/focus/query state never affecting the fresh shell; exactly one live query
reply; ordinary reconnect not resetting the shell or duplicating history; bounded
failure and native cleanup, including failed spawn and once-only recovery.

Verify at least one cold restart through the real daemon/TUI and one through the
compiled daemon path, using owned homes only. Run `bun run check`, registry preview
provenance/build and a scratch compiled smoke, then one fresh whole-change review.
Do not replace the separate experiment preview, installed executable or normal
home. A new implementation commit/push requires authorization separate from the
completed cleanup commit. Never merge #41 into main as part of this task.

## Non-goals

Exited-scrollback admission or retention changes; rendering research; dependency
patches/forks; benchmarks/soak; program-memory restoration; protocol redesign;
new UI controls/history views; changes to normal Work Craft or preserved preview
state; main merge readiness.
