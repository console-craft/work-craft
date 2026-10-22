# Native Terminal Contract Amendment: Input Admission And OSC8 Material

## Status And Authorization

**Implementation checkpoint (2026-10-22):** The separately approved plan's native
contracts, coherent local artifacts, raw-leaf adoption and connected review repairs
pass automated macOS acceptance: 1,797 tests, zero failures, build and relocated
compiled smoke. See the [current handover](../handovers/2026-10-22-output-projection-feasibility.md)
for the native review/fix proof, user-approved profiling window correction,
serial workload checks and explicit remaining limits. Historical approval and
failure evidence below is preserved; this checkpoint does not authorize old
feasibility Tasks 6–7, capacity acceptance or production parser/query-owner cutover.

On 2026-10-22 Ovi approved investigating and designing the two native contract
extensions explained after the blocked output/projection gate: preserve OSC8
hyperlink destinations in material frames, and admit input before native encoding
without delaying UI focus lifecycles. Ovi subsequently approved this full design
and writing its implementation plan on 2026-10-22. This does not approve execution
of an unseen plan, production cutover, or certify a passing gate.

The existing [output/lifecycle specification](2026-10-21-output-lifecycle-design.md)
remains binding. The [blocked handover](../handovers/2026-10-22-output-projection-feasibility.md)
records a stopped full run with three failures: normal-entrypoint second-tab
input/focus, a profiling byte-count assertion, and OSC8 material. The first two
remain independent investigations; the proposed hook is not their proven repair.
The current raw-path review-fix candidate is uncommitted and not merge-ready.

The initial directional approval covered contract investigation, this design and
its builder check. Full-design approval now permits writing the separately
reviewed implementation plan; implementation waits for that review. Do not resume
old Tasks 6–7 or production projection/response-owner cutover. Keep the same Work
Craft branch/worktree and the previously selected native execution method.

Workflow:

- [x] Confirm existing intent and preserve all original acceptance budgets.
- [x] Inspect installed native APIs and exact release source provenance.
- [x] Describe the two contracts, compatibility and hard acceptance gates.
- [x] Fresh builder check; resolve consequential gaps.
- [x] User approves this full design.
- [x] Write the [implementation plan](../plans/2026-10-22-native-terminal-contract-amendment.md)
      (awaiting its separate review before execution).
- [ ] Implement, verify and review under that plan, not this document alone.

## Why These Two Changes

The responsiveness/no-flicker improvement is already useful in manual testing:
pane output avoids root control renders and transient recovery retains native
presentation. That observation does not establish input ordering, missing-mode
recovery, complete native presentation, capacity or soak acceptance.

First, native modes affect encoded input. Received `ESC[?1h` followed by Up before
the scheduled parser drain produced `ESC[A`, not the required `ESCOA`. Fair output
draining must stay asynchronous, so input must wait for a captured finite parser
frontier. Wrapping public key/paste/mouse/focus methods passed focused cases but
entangled encoding with focus/destruction. Full-run tab entry still fails.

Second, the installed headless parser composes OSC8-linked `L` with attributes 0,
link ID 0 and no URL. The literal required URL is `https://example.test/λ`. This
failure occurs before JSON transfer or client drawing. The material projection
gate cannot pass while link destinations disappear. It does not establish whether
the previous Work Craft raw path supported clickable links.

## Evidence And Source Provenance

- Work Craft installs `@opentui/core` and `@opentui/react` 0.6.6. Registry metadata
  for core 0.6.6 reports git revision
  `212eb27da4adf5b907031ad153fc6a5b9f713fbf`; its package integrity matches `bun.lock`.
  See [registry metadata](https://registry.npmjs.org/@opentui/core/0.6.6).
- At that revision, [EmbeddedTerminal.ts](https://github.com/anomalyco/opentui/blob/212eb27da4adf5b907031ad153fc6a5b9f713fbf/packages/core/src/renderables/EmbeddedTerminal.ts)
  has public key/paste encoders, private mouse/focus encoding and no pre-encoding
  admission hook. `focus`/`blur` also manage renderer focus and key-release listeners.
- Its [compositor](https://github.com/anomalyco/opentui/blob/212eb27da4adf5b907031ad153fc6a5b9f713fbf/packages/native/src/embedded-terminal/compositor.zig)
  draws cells from raw text/graphemes/styles and constructs style attributes;
  that path does not propagate a hyperlink destination. Native link-pool helpers
  already exist, but their existence is not proof of embedded-cell integration.
- `/Users/ovi/Projects/opentui` is clean on `main` at `684d70ce1b442702a2f4cc05831539629387226c`,
  declaring core 0.5.12, with a different native API from the installed release.
  It is reference material, not an implementation baseline. Do not reset it,
  edit its main branch or assume its build reproduces the installed behavior.

Implementation planning must first establish a dedicated native source workspace
at the published 0.6.6 revision (or document an explicit compatible successor).
Reproduce the installed failures there before changing native source. If source
or reproducible packaging cannot be established, stop with that evidence.

## Goals, Constraints And Non-goals

Goals: correct event encoding against received output; normal synchronous native
focus/removal/destruction; retained mouse/selection/scroll behavior; resolved
hyperlink values in composed cells; reproducible native artifacts.

Keep one local daemon, React/OpenTUI, all three application input gates, existing
raw CLI/API input, query-response ownership, durable state and current transport.
Keep original runtime/reset identity, reply suppression/stamps and mode-2048
compatibility behavior. No native IDs or pointers cross JSON/process boundaries.

No second emulator, hand-coded terminal replies, ANSI screen reconstruction,
private-handle access from Work Craft, monkey-patching installed dependencies,
generic scheduler/event framework, new service/socket or product schema change.
No guessed URL parsing in Work Craft and no silent dropping of hyperlinks.
No paid calls, registry publication, push/merge, installed-app replacement or real
daemon restart/reset is authorized by this design. The separately approved
database reset/reseed was a one-time manual-testing operation, not test setup.

## Contract A: Native Pre-encoding Admission

### Ownership And Flow

```text
Physical event -> native focus/selection/routing lifecycle (synchronous)
                         |
                         v
                immutable encoding request
                         |
Work Craft: capture original scope/activity + received byte/grid frontier
                         |
               bounded pane-local FIFO
                         |
              existing fair parser drain
                         |
        revalidate -> resume native encoding once -> original stamped sender
```

Add one optional native embedded-terminal admission seam for generated child
input, before consulting parser modes. Without it, existing callers retain the
immediate native path and current return/event behavior. Automatic device-query
responses bypass this hook; they remain on the existing response path.

The proposed request is an opaque one-shot continuation plus a material event
description. Exact exported names are the builder's call, not a new wire protocol.
It must support copied key press/repeat/release metadata, paste bytes, canonical
terminal-cell mouse coordinates/modifiers/buttons/wheel intent, and focus-in/out
intent. Preserve current native key normalization, including Unicode and Kitty
metadata; Work Craft must not recreate those normalization/encoding rules.

The synchronous hook takes ownership of the request: resume immediately, retain
it in the caller's bounded queue, or cancel. Resumption takes an output sink
captured by the caller at admission, so delayed bytes cannot pick up a later
`onData` callback's authorization/activity. Encoding uses the same live terminal's
then-current parser modes and does not call the admission hook recursively.
An absent hook uses today's `onData(..., "input")` path.

Resume/cancel is idempotent and permits at most one encode/send. A cancelled,
destroyed or replaced terminal cannot encode, send, access a dead context, change
selection or touch another native instance. Callback failures cannot prevent
listener/handle/focus cleanup. A throwing admission callback cancels its request;
error propagation follows the library's existing handler conventions. Native
code owns no hidden unbounded list of retained requests; caller queues own their
request lifetimes and clear them on invalidation/unmount.

### Focus, Mouse And Selection Are Not Deferred Dispatch

Only child-input encoding may wait. Native `focus`, `blur`, `onRemove`, destruction,
renderer focus registration, cursor visibility and key-release listener changes
complete synchronously even while requests are pending. Resuming a focus report
must not focus/blur again, re-register listeners or restore a departed destination.
Normal focus transitions can produce deferred reports in original order; removal
or destruction cancels reports that no longer have a valid live target/scope.

Mouse routing is part of this contract, not a follow-up loophole. Native code
must reserve/consume the original physical event synchronously when deferring a
mode-dependent child/fallback decision, so ancestors do not also handle it.
After the frontier, native code encodes child mouse input or performs the existing
local wheel fallback exactly once. Do not replay the original event through the
renderer or re-run focus/default actions. Preserve the clicked terminal cell even
if the local crop moves before encoding.

Explicit local selection gestures and selection/copy remain native-owned and
usable. The native seam must preserve existing selection start/update/clear
semantics, including modifier behavior, and distinguish them from child-bound
mouse input. Any delayed mode-dependent default action must be represented and
completed/cancelled locally, not inferred from already-encoded bytes or applied
later to a different target. If this requires a renderer-wide async dispatch
framework or cannot preserve current semantics, stop and revise the proposal;
do not quietly remove selection, local scrolling or mouse interception.

### Work Craft Policy Remains Local

`workbench/` owns the queue/frontier and native invocation; `client/` owns live
authority/output progress; `shell/` continues owning focus and physical-input
context. Remove the uncommitted native-method replacement bridge when the new
contract is adopted; do not retain two input paths or replace it with another
focus wrapper. Keep a concrete owner only where callers require it.

At admission capture pane/epoch/runtime/reset, original connection/attachment/
navigation/per-tab input-grid context, input kind/activity sequence, sender and
the currently received raw byte/pane-marker frontier. Do not confuse the global
geometry sequence, per-tab input geometry generation and pane marker sequence.
Reject events not authorized at admission, then recheck that original scope
immediately before encoding/sending. Never relabel or replay disconnected input.

Later output cannot extend the frontier; later same-cursor resize markers cannot
overtake admitted input. Split native output offers at the captured byte boundary
even when retained/unread chunks coalesce. Use existing 8-KiB writes, 2-ms renderer
turn budget and sibling fairness; execute at most one admitted input per scheduler
quantum. Do not synchronously drain an entire backlog in an input callback.

Retain the candidate queue's 8-MiB admission ceiling for pending payload plus a
128-byte accounting charge per event, bounding descriptors as well as payload.
Validate per-event limits before additional payload copies and charge the queue
before retaining a request. Reuse owned event payloads where safe; otherwise make
one bounded lifetime copy, not another full copy in each layer. Release consumed references and
cancel the affected queue on overflow before entering existing pane recovery.
This is an accounting bound, not an exact JavaScript heap/RSS guarantee. Do not
raise existing transport/history budgets to make it pass. Oversized input must
also obey existing input trust-boundary validation.

## Contract B: OSC8 Material Preservation

Keep the existing public context/compose/buffer-lease/URL-resolution route. An
embedded-terminal cell linked by OSC8 must compose with a valid destination-
context link reference; public URL resolution while copying the frame yields the
exact URL, including Unicode. The composed buffer/context owns the reference;
it must not borrow a Ghostty parser pointer or native ID from another context.

Use the existing native link pool and checked resource ownership. Preserve ordinary
styles, styled blanks, wide-cell continuations, selection, clipping and scrollback;
closing OSC8 stops linking subsequent cells. Repainting, overwriting, clearing,
resizing and destroying must not leak or alias stale link IDs. Enforce existing
URL-byte/resource limits; overlong/invalid destinations and allocation failure
must follow explicit checked error/unsupported behavior, never a truncated or
guessed URL. No arbitrary new URL capacity is part of this amendment.

Material extraction copies resolved URL strings synchronously inside the public
lease, then releases it. JSON carries URLs, never context-local link IDs. A
different native drawing context must create/own its own link resources through
checked public APIs. Verify both source extraction and destination association;
a passing source-only assertion is insufficient to certify hyperlink projection.
Host terminals decide actual hyperlink activation; Work Craft must not open URLs
or introduce link-click commands here.

If the vendored parser does not expose the material needed for this integration,
first document that missing parser contract and the smallest extension. Do not
add another parser or assume style flags contain URLs. This is allowed native
source development under a later approved plan, not dependency-file patching.

## Delivery And Compatibility

Work has three checkpoints, in order:

1. Prove the two native contracts independently on the pinned source baseline;
   preserve default behavior without the new hook. No Work Craft cutover yet.
2. Build a coherent tested native/core/React artifact set through OpenTUI's normal
   build/package seams. Test Bun and the supported Node runtime and packed exports.
   Any revision change must be explicit and pinned; no unrelated upgrade sweep,
   `node_modules` edits, surprise `file:` links or registry publish. Artifact
   distribution/location is a planning detail, but reproducibility is mandatory.
3. Adopt only the input seam in the existing Work Craft raw leaf, finish all four
   review findings, diagnose the tab-focus/profiling failures rather than hiding
   them, and rerun the unchanged native material gate. Commit only verified work.

Passing these checkpoints permits reviewing progression to the remaining old
feasibility tasks; it does not itself certify selection/copy/large-frame/input
round trips or authorize daemon-owned production parsing/response changes.
Capacity, full soak and physical acceptance still belong to the original plan.

## Required Acceptance And Stop Rules

The implementation plan must include observable RED→GREEN tests, not only API
shapes or mocked calls:

- Deferred Up, Kitty press/repeat/release, Unicode, paste, mouse and focus report
  use modes parsed through their original finite frontier. Later output and
  same-cursor markers cannot move/overtake that frontier; sibling work still runs.
- Held input does not delay actual focus transfer, removal/destruction or listener
  cleanup. Renderer focus never points at a destroyed terminal. Resume twice,
  cancel/resume, callback throw, replaced target and unmount produce no duplicate,
  stale or redirected bytes and no extra focus churn.
- Mouse-tracking enable/disable while pending, local wheel scroll, explicit
  selection/copy and selection clearing behave like the no-backlog native control;
  clicked cell survives crop motion. Selection/scroll remain viewer-local.
- Original input kind/activity/sender survives deferral; connection, attachment,
  away-and-back navigation, runtime/reset and input geometry changes cancel the
  old scope. Pending event count/payload/copies plateau under a held frontier.
- Existing reconnect-to-idle, no-change failed-write completion, same-message
  byte/resize-gap recovery gating and held-control-flood bounds remain covered.
- Exact OSC8 URL survives BEL and ST termination, arbitrary byte splits,
  overwrite/close, Unicode/wide/combining/styled cells, clipping/scroll/resize and
  cross-process different-context composition. Test checked allocation failure,
  URL/resource limits, repeated repaint and reference cleanup without weakening
  the literal existing `https://example.test/λ` assertion.
- Native package tests/build, portable FFI and Bun/Node packed-artifact checks
  follow the selected source revision's AGENTS instructions. No ABI assumption
  is inferred from a TypeScript-only test or an older local checkout.
- Work Craft's normal-entrypoint Hyper-tab creation/switch/return, mirrored
  sessions, restart/split/dialog entry, query deadline and compiled smoke pass.
  Investigate the profiling byte-count failure with direct/native/app calibration;
  any demonstrated invalid measurement assumption needs recorded justification,
  not deletion or replacement with a weaker correctness check.
- `bun run check` passes with the OSC8 assertion still enabled; original burst and
  Neovim rollover tests pass three times serially with unchanged deadlines.

If any preserved native behavior or acceptance gate fails, stop with the actual
failure and its evidence. Do not announce completion from isolated passes, extend
timeouts, mark expected failures or resume production projection prematurely.

## Calls Made By The Author, Not Yet Proven

- Prefer a narrow native continuation/admission seam over wrapping focus methods
  or draining output synchronously. Exact API spelling/internal implementation is
  left to the builder, subject to the explicit lifecycle/mouse semantics above.
- Reuse native link-pool composition instead of a new Work Craft URL side channel.
- Retain the candidate input accounting bound and existing output scheduler;
  neither is evidence that the 50-pane memory/latency targets already hold.
- Treat native delivery as additive supported-source/artifact work, not permission
  to modify a different checkout, globally install a package or restart live apps.

The supported hook may simplify the input boundary; it is not proof that it fixes
every observed tab-focus failure. Report remaining failures independently.

## Design Check And Current Verification

A fresh read-only builder check on 2026-10-22 reported **nothing important left**
before planning. It checked the design, not native feasibility or implementation.
No native or application source, dependency, daemon or user state changed during
this design task. The native source checkout was read-only.

Fresh `bun run check` for this documentation change passed lint, formatting and
types, then reported **1,772 pass / 14 gated skips / 1 fail**, 12,468 assertions,
129 files, 136.61 s. The sole failure in that run was the unchanged native OSC8
assertion. The previously observed tab-focus and profiling failures did not
reproduce; no product code changed, so this is not evidence they were fixed.
Build/smoke were not reached by this red check. The existing lint and precommit-
fixture React act warnings remain. Full output is retained at
`/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/native-amendment-design-check-2026-10-22.log`.

Only this new proposed design is committed; existing implementation candidates,
gate fixtures, lock/package changes and historical approval documents are not
staged with it. Omit only the redundant pre-commit test job for this documentation
commit because the fresh full check has already recorded the intentional gate
failure; retain lint/type/message hooks. No tests are skipped or reclassified.
