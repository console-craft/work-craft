# Compact Data For The No-Fork Experiment

## Approved Scope

On 2026-10-22 the user approved this small experimental-only correction:

- Share repeated screen colors/styles and encode repeated cells compactly.
- Send paste bytes as base64 in bounded chunks over the existing local JSON
  connection, preserving order and cancelling remaining work after authority changes.
- Require the existing large-screen and 3-MiB paste cases to succeed; retain the
  interaction tests and add irregular, heavily styled screens.
- Do not add dependencies, replace the transport, raise limits or cut over production.
- If compact frames still cannot cover supported grids, report that limitation
  before adding a more elaborate delivery mechanism.

This supplements the [experiment design](2026-10-22-no-fork-terminal-performance-design.md),
not the production architecture. Baseline is `470a9a6`; the original #41, installed
app, normal database and running user processes remain untouched. The two existing
research-only exceptions remain unchanged; no new functionality loss is accepted.

## Builder Choices

These are engineering choices, not additional user requirements:

### Screen Material

Use a frame-local style table containing exact foreground/background RGBA values
and attributes. Each row is a list of `[count, text, width, styleIndex]` tuples.
Merge only adjacent identical cells, preserving zero-width wide tails, styled
blanks, combining text, row boundaries and the cursor. Native handles and
context-local glyph/link IDs never cross the wire. Hyperlink destinations are
already outside this experiment's acceptance contract.

The runtime builds this representation directly from its existing public native
buffer lease. Do not first build a full `MaterialCell[][]` or serialize the old
per-cell JSON. The drawing leaf consumes compact rows directly, using repeated
text/style chunks rather than expanding a giant plain-cell grid. Keep the old
plain extraction for the original fidelity diagnostics and small reference tests.

Validate dimensions, row widths, repeat counts, style indices, finite colors,
cursor values and UTF-8 byte budgets before native drawing or large allocation.
Count the complete wire envelope against 8,388,608 bytes, not just its row body.
Invalid/oversized frames fail explicitly and leave the last valid picture intact.

Compression is data-dependent. Test repeated and irregular frames, including
unique per-cell colors. A safe rejection is still a compatibility blocker, not
permission to call all supported grids qualified. If that boundary remains, stop
screen-format expansion and document the exact case instead of adding paging,
binary framing, deltas, codec negotiation or another compression layer.

### Paste Delivery

Keep semantic capture and the existing payload-plus-128-byte queue accounting.
Convert at most 65,536 raw bytes to base64 at a time, only when sending. Do not
retain the whole paste as both a numeric JSON array and an encoded string.

One transfer declares its identity, total raw length and original authority stamp;
subsequent chunks carry an exact byte offset. The receiver accepts one bounded
pending paste per fixture runtime. It rejects gaps, duplicates, mismatched totals,
invalid base64 and overlapping transfers. The total raw payload plus 128 bytes
must fit 8,388,608 bytes; each HTTP request independently fits the existing limit.

Assemble the bytes without writing any prefix to the PTY. On explicit completion,
recheck authority and invoke the native paste encoder once, retaining one pair of
bracketed-paste delimiters and its existing sanitization. Normal input must not
overtake a pending paste. Cancellation, failed requests, revocation, runtime exit,
shutdown and a finite four-second idle timeout release pending storage. There is
no retry that can duplicate child input and no execution under replacement stamps.

The deterministic child's receipt evidence must remain bounded too: base64 receipt
chunks or byte counts/digests can replace large numeric-array observations, while
small key assertions still inspect exact bytes. Never echo megabytes of numeric
arrays inside the screen-state response and mistake that diagnostic overflow for
a screen-format failure.

## Delivery And Verification

Use native execution with one final independent review. Keep capability-owned
tests and isolated registry OpenTUI 0.6.6 provenance. Prove codec round trips,
malformed-input rejection, successful real-PTY paste delivery, cancellation before
commit, compact large-frame drawing and all existing interaction/authority gates.
Run `bun run check`; report earlier intermittent reload/readiness failures honestly.

This slice does not include performance equivalence, production integration,
compiled no-fork relocation, Linux or physical-terminal certification. Measurement
follows only after the remaining correctness/resource outcome is explicit.
