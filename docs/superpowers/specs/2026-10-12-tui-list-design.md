# TUI List Design

## Approved direction

List is a persistent, single-selection collection of application entities. Its
virtual keyboard cursor is independent of the selected entity. Navigation changes
only the cursor; Enter or a successful primary click selects and activates a row.
Filtering belongs to callers. No markers, search, data-array API, interactive row
controls, multi-selection, or generic collection engine are introduced.

## Public contract

Export `List`, `ListItem`, and their prop types directly from `ui/components/list.tsx`.
List uses themed Box props and a native Box ref. ListItem uses themed Box props
except native focus props, requires a unique string `value`, and accepts `disabled`.
Rich non-interactive children are rendered unchanged; simple text is wrapped in
Text with the current semantic foreground.

```tsx
<List
  value={selected}
  onValueChange={setSelected}
  activeValue={preview}
  onActiveValueChange={setPreview}
  onActivate={openEntity}
>
  <ListItem value="a">Entity A</ListItem>
</List>
```

Both states support defaults and uncontrolled usage. Presence of `value` or
`activeValue`, including explicit undefined, establishes controlled ownership.
Controlled state never changes until acknowledged by the caller. An omitted
change callback makes that state read-only. `onValueChange(value: string)` fires
only for a different selection request. `onActiveValueChange(value: string |
undefined)` also communicates loss of the cursor when no eligible rows remain.
Automatic repair requests are deduplicated while awaiting acknowledgment.
`onActivate(value: string)` fires on every deliberate eligible activation even if
selection is unchanged or parent-owned. Enter auto-repeat does not activate.
Persistent selection is never automatically repaired or cleared.

## Focus and navigation

One focusable Box owns List input and contains a non-focusable ScrollArea with
keyboard fallback disabled. Rows are non-focusable; Tab remains owned by the
existing application focus scope. This avoids ScrollArea's native keyboard
handlers consuming unrelated List keys. Clicks focus the List endpoint before
activation so applications can deliberately move focus in onActivate.

On focus, retain an eligible cursor, otherwise use the eligible selected row,
otherwise the first eligible row, otherwise undefined. Initialize a missing
cursor on focus rather than mount; preserve it on blur. Repair an existing cursor
after removal, disabling, or visibility changes using the same fallback order.
Eligibility requires mounted, non-destroyed, ancestor-visible, enabled rows;
offscreen rows remain eligible. Navigation order follows rendered child order.

Down/j/Ctrl+n and Up/k/Ctrl+p wrap. Home/g and End/G choose enabled edges.
Ctrl+d/u move half a viewport; Ctrl+f/b and PageDown/PageUp move a full viewport.
Page movement measures laid-out row distance and clamps. Only exact supported
chords are consumed using preventDefault and stopPropagation. Enter activates;
Space and unrelated chords are left alone. Native callbacks run first and can
cancel built-in behavior.

## Scrolling and visuals

Use ScrollArea and native scrollChildIntoView after layout on focus entry, cursor
changes (including externally controlled changes), and relevant row/layout
changes. Manual wheel scrolling does not move the cursor or trigger continuous
snap-back. Oversized rows use native nearest-edge reveal.
The installed native reveal misses rows exactly one viewport tall; List adds a
narrow top-alignment fallback for that size without changing ScrollArea.

Disabled rows use muted/mutedForeground. A focused active row uses
focus/focusForeground, taking precedence over selection. Selected rows use
primary/primaryForeground. Unfocused active rows use selected or normal styling.
List does not reserve a marker column. Composed Text children own foregrounds;
callers may use controlled values to style them. Control hints belong to the List
Box, with concise navigation, activation, and half-page hints.

## Mouse and lifecycle

Hover does not change state. Primary press focuses List; activation requires a
matching release inside the enabled row. Leaving the row cancels the press,
while crossings between child hit targets do not. Disabled, hidden, destroyed,
cancelled, or stale rows cannot activate. Registrations and renderer listeners
are cleaned up on unmount. Native renderable IDs remain distinct from values.
Pointer containment includes clipping ancestors. Focus-entry reveal waits for a
pending row press to finish so it cannot move the clicked row before release.
Activation revalidates eligibility after caller change callbacks.
ScrollArea's existing shared pointer observer also tracks primary-button state
and gesture IDs. It observes each input batch before native dispatch; List matches
its down/up events to those reports so an outside release invalidates its press
even when multiple gestures arrive before a frame or in a single input chunk.
Reports are bounded to the current input batch. No additional input listener or
pointer parser is installed by List.

## Verification and scope

Colocated OpenTUI renderer tests cover initial focus, independent state,
activation, all key aliases, repeat/modifier handling, focus traversal, semantic
colors, controlled empty/read-only/unacknowledged state, dynamic eligibility and
keyed ordering, paging, manual scrolling, reveal, rich children, and mouse press
semantics. A components demo shows an externally filtered collection with a
preview and persistent selection. Run targeted tests and `bun run check`.

No focus-manager or scrolling behavior changes are required. The baseline has a
restricted relative theme import in Table; fix that import if needed to complete
the required repository check. The scrolling demo test also references a removed
Table fixture; align its selector with the existing wrapped Table example.
Keep all new edits unstaged, as requested.
