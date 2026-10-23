# Unpatched Runnable Preview

## Intent And Authorization

The user requested an actual runnable preview of the experiment to decide whether
it is a viable alternative to patched #41, not further standalone optimization.
They will try it first; assistant-led interactive evaluation and performance
comparisons wait for their next prompt. Required development regression/build
checks still apply and must not be described as that later evaluation.

The user also authorized dropping/reseeding Work Craft state and stopping its
panes/daemon/processes. This does not authorize terminating unrelated software.
Prefer a dedicated preview home so comparison remains simple; no installed-command
replacement is required. State cleanup is performed only with confirmed Work Craft
paths and managed shutdown, after a verified backup when existing data is reset.

This is a bounded integration attempt on `feat/no-fork-terminal-performance`,
starting from `d2ac489`. The original #41 branch remains untouched. It does not
authorize publishing, merging or calling the experiment production-ready.

## Deliverable And Stop Rule

Deliver **one executable**, `dist/work-craft-preview`, using the normal Work Craft
React shell, navigation, SQLite daemon and real user PTYs with **unmodified registry
OpenTUI core/React 0.6.6**. It must not use the fork's input-admission extension,
patched native library, test fixture runtime or an embedded fork-backed fallback.

The first handoff includes exact build/binary/state paths, a launch command,
seeded sessions/workspace/items/panes, a short manual checklist, known limitations
and safe stop/relaunch/reset instructions. Only then does the user conduct their
trial. Do not start an assistant-led terminal tour, benchmark, soak or comparison
before their subsequent prompt.

**Stop rather than expand:** if integration needs another substantial terminal
renderer, transport redesign, codec framework or new engine/dependency, preserve
the evidence and report a no-go/blocked preview. Do not automatically open another
research cycle or call an incomplete fixture the runnable application.

## Scope

The preview must exercise normal item opening, tab switching/creation, pane
splits/restart, dialogs/focus, mirrored clients, differently sized viewers, detach
and reconnect. Preserve the daemon's canonical grids, navigation authority,
original input identities, finite readiness and independent viewer browsing.
Input must not reach a replacement runtime/session or become authorized by a
retained picture. Overlays still reserve the status row.

No redesign of project discovery, persistence schema, CLI organization, themes or
general UI is requested. Keep Bun/React/OpenTUI and the single-daemon architecture.

## Engineering Choices

These choices are the builder's, not new user requirements.

### One Experimental Application Path

Integrate the daemon-parser route into this dedicated branch's application source;
do not maintain two production renderers behind a permanent runtime feature flag
or make a toy shell beside the app. Existing #41 remains the fork-backed control.
Change dependency manifests/lockfile on this branch to exact registry releases and
remove fork overrides from the preview dependency graph. Historical vendor files
may remain in Git but must not be resolved or embedded in the executable.

Use a separate preview build output/entrypoint with a safe preview-state default
(`$XDG_STATE_HOME/work-craft-preview`, or `$HOME/.local/state/work-craft-preview`).
An explicit `WORK_CRAFT_HOME` still wins. CLI and child daemon invocations from the
preview use the same executable/home. Never use the stale installed `work-craft`
command to seed or launch it. Add an explicit preview/protocol identity to the
daemon handshake so an incompatible old daemon cannot be silently reused.

### Runtime And Protocol

The server runtime owns one public native parser per live pane runtime. Feed PTY
output once, preserve its order with canonical resizes, and drain automatic query
replies once in the daemon. Retain the existing durable output/history ownership.
Do not let clients feed automatic replies from their displayed material.

Promote the concrete compact material and semantic-input support from experimental
utilities into the appropriate server/client-safe and workbench owners. Production
modules must not import `tests/` or `scripts/test-support`. Keep the pure wire
types/validators behind `@work-craft/server/client`; native parsing stays server-side.

Extend the existing local JSON connection with compact-frame requests/results and
semantic input. Reuse the real connection registry's attachment, navigation,
runtime, geometry, process, item ancestry, active-layout and eligibility checks.
Authorize material reads for the attached session's visible panes, not arbitrary
pane IDs. Encoding/input admission is checked against current authority, including
any geometry election caused by physical activity. Do not transplant the fixture's
synthetic revoke endpoint or grant authority using a connection ID alone.

Coalesce material refreshes from pane-local output/geometry updates, with at most
one request in flight per mounted pane and explicit cancellation on scope change.
Always request current material on mount/reconnect even if no new output arrives.
Retain the last coherent picture while gated; frames cannot grant live authority.
Keep whole-envelope, pending/in-flight and decoded-text resource bounds; failures
remain explicit and scoped rather than unbounded retries or silent truncation.

Use the bounded base64 paste transport with one native encode/commit. Preserve
original sender/stamps, byte ordering, one bracketed envelope and native
sanitization. Reject oversized native input explicitly; do not invent a workaround
for the shared one-MiB native paste ceiling in this integration.

### Presentation And Focus

Replace the patched native terminal leaf with an app-owned material leaf, retaining
existing pane keys, clipping, dialogs and shell focus rules. Shell registration
depends only on the concrete renderable capabilities it uses, not an assertion
that the material leaf is an `EmbeddedTerminalRenderable`.

Readiness means a current-identity/current-geometry frame has actually been applied
with usable layout. It must not depend on a child cursor redraw or be extended by
later output. Physical blur/destruction remain synchronous, independent of network
or queued input completion.

Try the smallest public drawing change that preserves explicit native cell
positions, including regional indicators; do not concatenate/re-segment cells into
different terminal positions. Preserve styled blanks, wide tails, combining text,
cursor, local selection/copy and scrolling. Do not copy upstream internals or build
a second terminal engine. If public primitives cannot do this with a small local
change, invoke the stop rule instead of another rendering redesign.

Cold history remains presentation-only relative to a new runtime: old output may
supply a retained picture, never input modes or automatic query replies for a fresh
child. Preserve durable records/history. Do not quietly replay old modes into the
new live parser to make a screenshot look restored. Any additional cold-history
presentation gap discovered during integration must be explicitly reported as a
preview limitation/blocker before handoff, not called parity with #41.

## Known Boundaries And No Hidden Acceptance Changes

- Unique-color large grids still exceed the compact eight-MiB representation.
  Keep explicit bounded errors; no lower supported dimension or higher limit.
- The one-MiB native paste ceiling also exists in the fork-backed control. It is
  not a new no-fork regression and is not a separate large-paste repair project.
- Regional-indicator positioning is a genuine candidate defect, not a waiver.
  A small explicit-position repair is permitted; an expanding renderer is not.
- Hyperlink destinations and invisible-wide second-cell styling retain their
  existing research-only status. Nothing here authorizes shipping those losses.
- An early preview can expose documented limitations for the user's decision;
  it cannot be described as an equivalent drop-in replacement while gates fail.

## Build, Regression Checks And Handoff

Verify installed and bundled registry dependency provenance, native asset hashes
and absence of fork-only imports/extension code in the reachable preview graph.
An overridden package that merely reports version 0.6.6 does not establish this.
Reject native-library override environment variables when verifying the preview.

Keep existing tests that still exercise applicable contracts. Replace fork-specific
implementation assertions with equivalent app-observable input, authority, query,
layout and cleanup assertions; preserve original diagnostics as history/opt-in
evidence, not as silently deleted coverage. Add real compiled-daemon/PTy and
disposable-client regression coverage. Tests stay with their capability owners.
Run `bun run check`, the preview build and a bounded relocated compiled smoke with
owned data, including at least one actual shell pane. Use native execution and one
final independent whole-change review/fix pass, as previously chosen.

Before handoff, seed the preview home with Playground/Focus, one shared workspace,
five items, two tabs and three shell panes rooted in this checkout. Verify persisted
state and the actual executable/provenance, then leave a clear daemon state for the
user's launch. If the normal home is used instead, back it up and perform the
already-authorized managed reset; do not delete arbitrary directories or Git work.

The manual checklist covers startup/navigation, ordinary typing/Unicode/paste,
Neovim or another real TUI, tab/split/focus/dialog behavior, independent/mirrored
sessions, resize, disconnect/reconnect and known limits. The user tests first.
Performance equivalence, prolonged manual acceptance, Linux and capacity/soak
remain unclaimed until separately exercised.
