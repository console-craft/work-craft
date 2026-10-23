# Stopped-pane scrollback and manual shell reactivation

## Status and intent

Product direction and engineering design approved by the user on 2026-10-23.
A fresh builder check found no important unanswered questions. The user subsequently
approved native implementation, optional Menu test stabilization and local commits;
push is not implied and #41 must remain unmerged. Verification/acceptance is recorded
in the companion handover rather than inferred from design approval.
It follows cold-history restoration at `5c5304c`; CI run `39927239183`, attempt 2,
passed after the user reran the failed Menu test job. That intermittent failure is
not claimed repaired.

The user explicitly chooses the desired behavior rather than requesting a
comparison with original #41:

- Output remains scrollable after the pane's shell exits.
- Reactivate starts a genuinely fresh shell while retaining bounded scrollback.
- A visible `[work-craft: shell restarted manually]` divider separates generations.
- Do not add preferences, a history screen, search, archives or unbounded retention.
- Favor small implementation and bounded resources over speculative capabilities.

History belongs to the pane; process state belongs to each shell. Reactivate is
not client Reconnect. Closing/reconnecting a TUI neither restarts a shell nor adds
a divider. This is a separate development step from the accepted cold-history work;
new implementation commit/push authorization is not implied. Keep #41 open and
unmerged into main. Preserve the user's normal home and installed executable.

## Required behavior

1. A live pane keeps its existing material, application mouse/input and scrolling
   behavior. Finishing a command inside a live shell is not a stopped-pane event.
2. After actual shell exit, the visible final picture and older retained output
   remain available through the same pane's wheel scrolling. Read-only browsing
   also applies to failed/interrupted panes with retained output, not to a start
   still in progress. No typing, paste, mouse/focus report or old query may reach a
   dead child, spawn a replacement, or grant input authority.
3. Explicit Reactivate/CLI process.restart starts one fresh runtime below the
   manual divider. Its input modes and query replies are fresh. Output from old
   generations remains presentation only, including partial CSI/OSC/UTF-8 endings.
   Reset each client's local scroll position to the fresh-shell boundary on the
   new runtime identity; old scroll offsets cannot hide the new prompt.
4. Repeated exits/reactivations preserve ordered generations and one manual
   divider per admitted restart preparation. A running/already-starting pane or
   rejected stale command must not append another divider or start marker.
5. Each client retains its own scroll position. Ordinary client reconnect, tab
   revisit and cache eviction preserve access to retained output without spawning
   or adding dividers. A daemon restart does not automatically restart a durably
   exited/failed pane; its history remains readable on demand. Existing recovery
   policy for interrupted running panes remains unchanged.
6. Preserve supported cell positions, styles, inverse text, styled blanks and
   truncation notices. Existing RI, hyperlink and invisible-wide limitations are
   unchanged; this is not resumed process memory or new rendering fidelity.

## Engineering choices proposed by the agent

### Read-only material ownership

Keep the daemon authoritative. `api/connections.ts` already calls projectionScope
with requireRunning=false for terminal.material, while semantic/paste/raw input
requires a running child. Reuse that separation; do not relax input admission to
make scrolling work and do not add a new public history protocol.

Stopped reads use the existing material request/response DTO and exact current
epoch, attachment, navigation, per-tab geometry, pane/layout and runtime identity.
If reconstruction becomes asynchronous, await it and revalidate the complete
read scope and live socket identity before sending a result. Generation changes,
reactivation, archival, navigation or disconnect invalidate obsolete work.

The TUI gets separate read-browsing and child-input eligibility. An eligible
stopped viewport handles wheel offset changes locally, requests material, and
never sends those events as terminal.semantic. Keyboard/paste/focus admission
remains closed. Covered, disconnected, obsolete and unusable viewports do not
gain browsing authority. Preserve current focus, Reactivate and status-bar gates.
Stopped browsing does not claim PTY sizing/input activity; do not resize a child
or change another client's scroll position. Hide a stopped terminal's cursor.

### Lazy, single-slot stopped display

Keep prompt exit cleanup: release the PTY/process and destroy the live parser
after its final output has drained. Retain the existing cheap final viewport for
immediate display where available; do not eagerly capture full history on every
exit or keep a native parser for every exited pane.

Build older stopped material lazily from TerminalHistory.readForRecovery using
the existing isolated replay/inert-capture path. Keep at most one daemon-wide
cached stopped display parser, restricted to frame reads and destruction. It has
no PTY, input encoder authority, query callback or background refresh loop. The
cache is an optimization; durable bounded bytes/metadata remain authoritative.

The cache identity includes pane, runtime identity and historical grid identity.
Repeated offsets and multiple clients reading that same identity reuse it; scroll
offset is per request, not part of the cache key. Visiting another stopped pane
evicts and destroys the previous display. Eviction changes no durable state.
Reactivation/replacement of the cached pane, teardown and daemon shutdown release
it. After daemon restart, a stopped pane can be reconstructed without any runtime
being spawned. Missing history returns a deterministic empty stopped picture.

Serialize stopped reconstruction and manual-start history preparation; coalesce
same-key requests and keep pending request metadata finite under the existing
128-request scale, with explicit overload rejection rather than an unbounded work
queue. Read retained bytes only when a construction actually owns the slot. Evict
the stopped display before allocating reconstruction resources for another pane.
Do not let abandoned/stale construction repopulate the cache after invalidation.

Tradeoff: alternating between different stopped panes can repeat reconstruction.
This deliberate single-slot limit keeps one-person ownership and memory simple;
do not add a multi-pane LRU or another configuration option without evidence.

### Historical geometry and resources

Keep one-MiB raw history, 1,024 shared resize/start markers, 10,000 native
scrollback lines, 2,097,152 drawing cells per native context and eight-MiB
material/transcript/envelope ceilings. Do not increase any existing limit.

Stopped display uses its last actual recorded runtime grid, with existing legacy
fallback geometry. Viewer resizing changes crop/read context, not the historical
terminal stream. Record resize markers only when a runtime parser/PTY actually
receives that resize; do not append synthetic stopped resizes merely because a
viewer or sizing owner changes. Reactivate records its newly elected grid before
new output. No database migration or public DTO change is expected.

The additional persistent native ownership is at most the single stopped-display
cache, not one allocation per dead pane. Reconstruction is bounded and yields
between bounded units. Keep native leases and temporary parsers balanced on every
success/failure/cancellation path, including cache eviction and shutdown.

This is a resource policy, not a measured latency claim. Validate cache reuse,
bounded ownership and the absence of new work on live output before making any
performance claim; a benchmark/soak campaign is not part of this step.

### Manual restart ordering and isolation

Extend the private start-preparation seam so RuntimeRegistry reserves the pane
before any asynchronous history preparation. Application code remains the author
of durable history; do not introduce an independent application-side startup lock
that shutdown cannot see. Validate the spawn policy, then prepare the admitted
manual generation under that owned reservation:

1. Record the existing restored presentation boundary at the elected grid, before
   the divider's bytes. Its meaning is that this generation begins with restored
   inert display; it is not restricted to daemon-triggered recovery.
2. Append the manual divider once, flush bytes/metadata, then read recovery material.
3. Reuse isolated reconstruction to obtain a distinct fresh live parser before
   spawning. Never turn a stopped cached parser directly into the new child's
   input/query parser. Replace/evict stopped presentation ownership safely.
4. Preserve pending-start cancellation, generation checks and shutdown waiting.
   Start/output/status ordering remains authoritative even with simultaneous
   viewers and explicit restart requests.

Once durable preparation occurred, a capture/spawn failure may leave its divider;
the existing failed status identifies that the attempt did not produce a running
shell. Preserve bytes and do not retry automatically. Invalid policy or duplicate
admission rejected before preparation adds no divider. A later explicit retry is
a new generation, never reuse of failed input authority.

### Failure policy

Unsupported or over-budget reconstruction is a scoped material/start failure,
not silent loss/truncation or an instruction to keep more native state. Preserve
raw durable output and the existing final picture where it already exists; do not
present that one picture as successfully reconstructed scrollback. A failed read
must not change process status, restart anything or poison other panes. Retrying a
user read is allowed; no automatic reconstruction or child-restart loop is added.

## Ownership and implementation reach

- server/terminal: reusable bounded reconstruction, one stopped-display owner,
  final-output cleanup, asynchronous start preparation and generation lifetime.
- server/application/app.ts: actual resize timeline, scoped material lookup,
  manual divider/boundary ordering and durable flush before spawn.
- server/api/connections.ts: await material safely and revalidate existing read
  authority; keep all write/semantic/paste gates intact.
- tui/workbench: separate local read-only wheel browsing from child input,
  request/present stopped material and preserve per-client offsets/focus policy.
- Capability-owned server/TUI tests and package-wide real-process acceptance:
  behavior, resource accounting, races and negative input authority.
- Current README/source map/handover: record accepted behavior and limits after
  implementation. Preserve earlier dated decisions as history.

## Verification required before acceptance

- Real multi-screen shell exit: older rows remain readable, no live input or child
  restart occurs, final viewport appears without eager full-history capture.
- Native stopped cache: repeated reads/offsets and two clients reuse one entry;
  switching panes, eviction, failure, reactivation and shutdown balance ownership.
  Restarting the daemon leaves exited panes stopped and history readable on demand.
- Actual sockets: stale/foreign/hidden/archived scopes reject read results, including
  changes while construction is awaiting; every stopped semantic/raw/paste/focus
  attempt remains rejected and does not mutate sizing or start counts.
- Manual Reactivate: new PID, one divider, early/middle/tail rows retained, fresh
  Up/paste/mouse/focus/query modes and exactly one response to a new live query.
  Repeat exit/reactivate, interleave with daemon recovery, reject duplicate starts,
  and test exit/shutdown while reconstruction is pending.
- Geometry/retention: width changes while stopped, scoped crop, legacy unknown
  grid, Unicode/styles/inverse/styled blanks, partial parser tails, repeated rows,
  same-cursor starts and truncation remain correct within unchanged ceilings.
- Failure paths: forced native/flush/capture failure, bad cwd/executable and
  replacement during read preserve bytes, release resources and isolate panes.
- Real daemon/TUIs: wheel browsing after exit, independent client offsets, explicit
  Reactivate, subsequent input, tab revisit/client reconnect without new dividers
  or OpenTUI console errors. Use disposable homes, not the user's normal home.
- Full bun run check, compiled recovery smoke, one fresh final implementation
  review, and manual acceptance before any new commit/push. Log commands with
  stdout/stderr mirrored through tee and pipefail as requested in AGENTS.md.

## Non-goals

Historical-behavior comparison, new preferences/controls/history UI, unlimited
logging, search/export/archive, terminal fidelity research, dependency patches,
new restore adapters, process-memory restoration, default automatic respawn,
normal-home reseeding, installed-command replacement, benchmark campaigns or main
merge readiness.
