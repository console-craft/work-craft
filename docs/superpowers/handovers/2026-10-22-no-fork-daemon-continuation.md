# No-Fork Daemon Continuation — 2026-10-22

## Outcome

The real-PTY/public-input experiment clears its tested small-frame interactions
and authority gates. The **current full-cell/full-frame JSON representation is
not correctness-qualified**: an allowed large grid cannot fit the existing
8-MiB retained boundary. This is an application-representation blocker, not a
failure of OpenTUI's public parser or evidence that no upstream-only design works.

No production source, dependency, vendor artifact, installed app or user runtime
was changed. The original #41 remains the control. No performance equivalence or
fork-free application/build is claimed.

The user approved continuing research with exactly the invisible-wide second-cell
style/background limitation, in addition to hyperlink destinations. That is
research permission, not shipping approval. The prior diagnostic `daemon` route
remains unchanged and red; no further compatibility concession was made.

## Reproduce

```sh
bun test scripts/probe-no-fork-terminal.test.ts
bun scripts/probe-no-fork-terminal.ts contracts /absolute/owned/evidence
# Currently exits nonzero at the preserved valid-large-grid assertion:
bun scripts/probe-no-fork-terminal.ts projection /absolute/owned/evidence
```

The hardened launcher bundles the projection tests plus separate `runtime.js`
and `program.js` companions into one independent registry consumer. Core/React
remain external; native path/version/SHA-256 and shared core are checked before
tests. Native asset overrides and ancestor workspaces remain rejected. Missing
companions fail before artifact creation/installation; normal tests need no network.

One owned Bun runtime binds a private Unix socket and owns one public parser and
one real PTY program. The program runs raw-mode deterministic fixture code, not a
user shell or startup configuration. It records actual received bytes in
`program-input.jsonl`. Explicit IPC byte acknowledgements establish output parsing
and input receipt; visible cursor redraws are not readiness handshakes.

Two independent renderer contexts receive plain material over the socket. The
test-owned leaf uses public TextBuffer/TextBufferView APIs, semantic key/paste/
mouse/focus translation and local selection/copy. No dependency methods, native
private fields, copied normalizer or alternate VT parser are used. All of this
is experimental scaffolding, not the normal application's transport or authority
integration. Generation-revocation commands deliberately exercise test stamps;
they do not certify the real application's disconnect/navigation/restart path.

## Passing Gates And The Preserved Failure

Final opt-in checkpoint: **18 pass / 1 fail / 112 assertions** in the isolated
registry consumer after review fixes. The passing count includes explicit
rejection diagnostics, not qualification of oversized frames or pastes. Cases cover:

- Ordinary Unicode, wide continuations, combining marks, styled blanks, colors
  and line cursor in two differently sized views of the same persistent child.
- Application arrows and bracketed paste after over 1 MiB output, including a
  late material viewer; exactly one hidden query reply despite two frame reads.
- Byte-split UTF-8/CSI, long OSC8 text and clear/repaint without URL assertions.
- Independent browsing, local Unicode selection/copy and wheel fallback; retained
  pictures cannot install old input modes into a fresh child.
- Seventy-eight key events in each of application-arrow and Kitty-31 mode windows,
  compared with stock public `encodeKey` and then observed at the real PTY:
  navigation/function/control keys, Unicode, associated text, layout alternatives,
  repeat/release, keypad/named keys and modifier variants. This is a finite corpus, not exhaustive
  keyboard/platform compatibility certification.
- Buffer mutation and mouse-shaped paste remain the original sanitized paste.
- Live mouse press/wheel and focus-in/out reports, disabled-mode silence,
  synchronous physical blur/destruction and early-exit cleanup.
- Actual native-dispatched input through the bounded stamped queue; captured
  original sender, attachment/navigation/geometry/runtime/epoch invalidation,
  away-and-back generations, independently rejected stale server inputs and frames,
  and two resizes at the same byte cursor.
- Fresh publisher sequence 1 after predecessor sequence 100, delayed predecessor
  rejection, and rejection of late material after destruction.
- Rejection before retaining unauthorized paste, 8-MiB queued-plus-in-flight
  accounting with 128 bytes/event, abort on teardown, and explicit oversized-frame
  error/recovery without an unbounded fallback.

The failing gate uses **512×512 = 262,144 cells**, below the existing 1,048,576-cell
limit and 4,096-per-axis contract. Even the smallest cell in this DTO is 66 JSON
bytes. A conservative 64-byte lower bound requires 16,777,216 bytes before row or
envelope overhead, already twice the 8,388,608-byte boundary. The native parser
accepts the resize when given the appropriate public context capacity; a small
fixture default was repaired rather than mislabeled an upstream limit.

The prototype refuses known-impossible frames before extracting/copying all cells,
and counts actual serialized rows for other material. The large-grid acceptance
assertion still fails; a safe rejection is not support for that grid. The separate
rejection/recovery assertion passes. No dimension is silently removed and no
budget is raised.

The semantic paste wire format has another demonstrated expansion limit: a
3-MiB paste costs 3,145,856 logical queue bytes but serializes to 12,583,097 JSON
bytes with the current numeric-array DTO. HTTP rejects it with 413 and the child
receives no bytes. The diagnostic verifies explicit failure and released queue
accounting; it **does not qualify large-paste delivery**. This is another
unwaived representation gap to solve, not a newly accepted input concession.

## Local Evidence

Root: `/private/var/folders/f3/1n3tcb0x5yj4d887rrm_ns_80000gn/T/opencode/no-fork-continuation-evidence/`.

- `projection-Hr3LqX`: accepted-exception primitive characterization.
- `projection-DUO9ui`: missing real runtime RED; `projection-kKbVat`: initial real
  PTY/two-renderer/rollover/query GREEN.
- `projection-XAhean`: missing key/paste hooks RED; subsequent per-event comparison
  artifacts record adapter ABI fixes without changing the upstream implementation.
- `projection-ji6sB0`: mouse/focus/copy RED; subsequent pointer/authority runs record
  their passing integration assertions.
- `projection-4zWO0y`: authority/accounting RED; `projection-PJSuE3`: computed
  view-geometry regression before the native layout commit was awaited.
- `projection-UbvVM9`: initial small-context capacity failure, not final blocker.
- `projection-MK2r43`: 17 pass/1 fail, native provenance, child input logs and
  `roundtrip-*/large-frame-observation.json` with the exact budget rejection.
- `projection-k38YAN`: all three review findings reproduced, plus the existing
  large-frame failure; `projection-ZgCMVd`: late-frame-after-destruction regression.
- `projection-G1koFu`: final 18 pass/1 fail/112 assertions, expanded key corpus,
  real wheel-picture change, publisher-scoped sequence handling, large-frame
  rejection and `paste-transfer-observation.json` with HTTP 413.

Only the socket uses a shorter owned OS temporary directory because macOS Unix
socket paths cannot fit the retained-evidence path. Normal/failure teardown removes
that directory; logs and input observations remain in the retained consumer.

## Verification And Review

Launcher tests pass 12/12 (33 assertions); a fresh registry `contracts` run passes
7/7 (`contracts-wf0nZl`). The **final post-fix `bun run check` passed**:
1,809 tests, 14 skips, zero failures, lint/format/types, build and relocated
compiled smoke. That build/smoke still uses the unchanged fork-backed application,
not a compiled no-fork consumer. An earlier full check had 1,808 pass/14 skips/
one failure in unchanged `raw stage 1 key sequences drive the shell`, waiting for
reload authority withdrawal; its build/smoke stages were not reached.

### Independent Review Disposition

One read-only review of the frozen staged changes against `788fb11` found three
Important defects, no Critical or Minor findings. All three were reproduced and
fixed in one pass, without a second reviewer:

1. Missing public keypad/named-key translations: expanded app-owned aliases and
   real-PTY stock-reference regressions, including keypad navigation/operators,
   locks and modifier keys. No upstream normalizer was copied.
2. Wheel offset without material retrieval: connected the semantic fallback to
   an offset frame request and repaint; the requesting viewer's historical row
   must actually change while its peer remains unchanged.
3. A sequence watermark surviving publisher replacement: scope it to epoch/runtime
   while retaining complete authority-stamp checks. A new publisher starts at
   sequence 1; predecessor frames remain rejected.

An additional author-found lifecycle regression rejects late frames after view
destruction instead of accepting them and allocating new drawing resources. It
also went RED→GREEN in the same fix pass. Post-fix opt-in results above retain
only the known large-frame acceptance failure. Default repository-suite status
is reported separately; none of these results means that check is green.

Review exclusions stand: production navigation/reconnect/restart integration,
compiled relocation, remaining failure permutations, performance/capacity/fairness/
soak/RSS, Linux/physical terminals, the approved research exceptions, alternative
representations, and repair of unchanged application readiness/reload failures.
The observed 3-MiB paste rejection is explicitly an additional representation
blocker, not a passing input-delivery assertion. No deferred review minors.

Two initial normal commit-hook attempts failed in unchanged application tests:
`raw stage 1 key sequences drive the shell` (reload authority/focus timeouts) and
`terminal focus readiness cannot reuse a cursor shown before the entry gesture`
(the previously documented redraw dependency). The reload case passed its focused
rerun; the readiness timeout reproduced. No hook was bypassed, deadline raised or
assertion weakened; the later green run does not erase those earlier failures.
Normal-hook commit verification is performed separately and never bypassed.

## Recommendation And Remaining Gates

Keep the no-fork direction open, but **do not adopt this full-frame representation
or ask to waive large-grid support**. The next technical step is bounded material
delivery (for example, viewport/page or compact-run values over the same local JSON
model), with coherent-frame, resource and selection behavior proved before timing.
This is a future design task, not a claim that any particular alternative works.
Input delivery also needs a bounded representation that does not expand admitted
large pastes past the transport limit; safe rejection alone is insufficient.

Compiled no-fork relocation, remaining allocation/transfer-failure permutations,
normal-application adoption, performance comparison, capacity/soak, Linux and
physical-terminal acceptance remain unverified. They were not waived by the
research exception or inferred from the current passing small-frame cases.
