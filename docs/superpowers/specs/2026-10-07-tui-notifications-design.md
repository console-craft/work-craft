# TUI Notifications And Toast Design

## Goal And Scope

Add a small notification system to the reusable React/OpenTUI component library.
A notification is event data retained in client-local history; a toast is one
immediate presentation channel. Native terminal notifications are the other
channel. Hiding a toast does not delete its notification.

Implement imperative creation, focus-aware delivery, a root-mounted Toaster,
semantic variants, pointer-only actions and dismissal, paused-on-hover expiry,
bounded stacking, and bounded observable history. Demonstrate these capabilities
in the existing components demo.

This follows the Work Craft architecture, TUI source organization, and focus/input
contracts. The library imports no application capabilities. Durable notification
history and cross-process events remain application/server responsibilities; this
in-memory history does not change the disposable-client architecture.

All work stays on the current branch. New changes, including this specification
and the implementation plan, remain unstaged and uncommitted.

## Approach

Use a plain notification store with an imperative API and a React Toaster. The
store owns records, pending delivery, active toast state, retention, and timers.
Toaster connects the store to an OpenTUI renderer and renders the active toasts.
React subscribes using its native external-store facilities; no state-management
dependency, event bus, or notification provider is needed.

A default store supports ordinary callers. A small store factory supports
isolated tests and demo lifetimes. A store accepts one connected Toaster at a
time; a second simultaneous connection fails clearly rather than delivering twice.

Alternatives considered:

- A React provider and hook naturally scope state but complicate imperative calls
  from outside React.
- Toaster-local state with a global emitter makes history and pre-mount calls
  awkward and divides lifecycle ownership.

## Public Surface

`ui/notifications.ts` exports `notify`, `createNotificationStore`, and their public
types. `ui/components/toast.tsx` exports `Toaster` and its props/position types.
Use direct imports, following the repository's no-barrel convention.

```tsx
const id = notify("Note created", {
  variant: "success",
  description: '"TUI ideas" was created',
  delivery: "auto",
  duration: 5_000,
  action: { label: "View", onPress: () => openNote(noteId) },
});

notify.dismiss(id);
notify.clear(id);
notify.clearAll();

<Toaster position="bottom-right" />;
```

The callable API exposes these operations:

- `notify(title, options?)` creates a record and returns its stable string ID.
- `notify.dismiss(id)` hides an active toast or cancels pending delivery, setting
  `dismissedAt`, while preserving its history record. Repeated dismissal and
  dismissal of missing or native-delivered records are no-ops.
- `notify.clear(id)` permanently removes the record and any pending/active state.
- `notify.clearAll()` permanently removes all records and pending/active state.
- `notify.getSnapshot()` returns a stable, read-only history array, newest-first.
- `notify.subscribe(listener)` returns an unsubscribe function. Snapshot identity
  changes when observable history changes, not simply when a timer is scheduled.

`createNotificationStore({ maxHistory? })` creates an isolated store with the
same callable API. Pass it as `<Toaster store={store} />`; omitting `store` uses
the default store. Keep renderer connection and timer manipulation internal to
the library rather than adding public delivery-adapter APIs.

Notification options:

| Option        | Contract                                            | Default   |
| ------------- | --------------------------------------------------- | --------- |
| `variant`     | `default`, `success`, `warning`, `error`, or `info` | `default` |
| `description` | Optional plain-text body                            | Absent    |
| `delivery`    | `auto`, `toast`, or `native`                        | `auto`    |
| `duration`    | Finite milliseconds, zero means persistent          | `5_000`   |
| `action`      | Optional `{ label: string, onPress: () => void }`   | Absent    |

Action callbacks are synchronous from the library's perspective. Async work and
its error handling belong in the caller; the library does not await promises.

Toaster props:

| Prop         | Contract                                               | Default        |
| ------------ | ------------------------------------------------------ | -------------- |
| `store`      | Notification store to connect                          | Default store  |
| `position`   | `top-left`, `top-right`, `bottom-left`, `bottom-right` | `bottom-right` |
| `maxVisible` | Positive integer visible-toast limit                   | `3`            |

`maxHistory` defaults to `100`. Validate configured limits as positive finite
integers and duration as finite and nonnegative before mutating store state.
Unknown IDs are harmless. No aliases such as `toast()`, `notify.native()`, or
semantic convenience methods are needed.

## History Records

Expose immutable records with:

- `id`, `title`, optional `description`, and `variant`;
- `delivery`: requested delivery mode;
- `channel`: `null` before delivery, then `toast` or `native`;
- `createdAt`: creation timestamp in epoch milliseconds;
- `deliveredAt`: delivery timestamp, initially `null`;
- `dismissedAt`: toast dismissal or pending-cancellation timestamp, initially
  `null`.

History is separate from internal timer, hover, pending, and callback state.
Read-only snapshots do not expose action callbacks or allow history mutation.
Actions are immediate toast affordances, not durable/history actions. Release
their callbacks when no active or pending toast can invoke them.

Native records have a delivery timestamp and channel but no active toast or
expiry timer. A successful native send means OpenTUI accepted the terminal
notification; it does not confirm desktop display, user receipt, or dismissal.

History retains expired, manually dismissed, action-dismissed, and overflowed
toast records until explicitly cleared or evicted by retention. At `maxHistory`,
remove the oldest record permanently, including its toast if still active. This
explicit retention boundary also applies to persistent toasts. There is no
unbounded archive behind the limit.

## Delivery

Record the notification in history before immediate delivery. Resolve a channel
once at delivery time:

| Requested mode | Terminal state | Result                         |
| -------------- | -------------- | ------------------------------ |
| `auto`         | Focused        | Toast only                     |
| `auto`         | Blurred        | Try native, fall back to toast |
| `auto`         | Unknown        | Try native, fall back to toast |
| `toast`        | Any            | Toast only                     |
| `native`       | Any            | Try native, fall back to toast |

There is no `both` mode. Native delivery does not expose toast actions. Callers
requiring an immediate action choose `delivery: "toast"`.

Use OpenTUI's public `CliRenderEvents.FOCUS` and `BLUR` events to track terminal
focus. Start at unknown before observing an event; do not inspect renderer
private state or infer terminal focus from keyboard focus. Read current public
capabilities at delivery time, and use
`renderer.triggerNotification(description ?? title, title)` for native delivery.
Unsupported capability, a false send result, or a thrown native-send error falls
back to toast without creating a second history record.

Focus changes never reroute already-delivered records. In particular, focusing
the terminal does not replay native notifications as toasts. Capabilities becoming
available later likewise do not redeliver prior records.

Notifications created without a connected Toaster remain pending, without expiry
timers. On connection, process pending notifications oldest-first using current
focus/capabilities and the configured visible limit. Clearing or dismissing a
pending record prevents its later delivery.

## Toast Lifecycle And Limits

The store owns toast timers; expiry does not depend on React render timing.

1. Toast delivery sets `channel` and `deliveredAt`, activates the toast, and starts
   its timer unless duration is zero.
2. Hover cancels the scheduled expiry and records the remaining duration.
3. Leaving resumes the remaining time rather than restarting the original
   duration. Moving between descendants must not restart or briefly unpause it.
4. Expiry, pointer close, imperative dismissal, action success, or visible overflow
   deactivates the toast, cancels its timer, and sets `dismissedAt` once.
5. Dismissed toasts never reappear when another toast closes.

Every toast includes a pointer-only close control, including persistent toasts.
An action calls the callback and dismisses after it returns successfully. A
synchronous throw leaves the toast active and propagates through OpenTUI's normal
mouse-handler error reporting; do not silently swallow application errors.

When active toasts exceed `maxVisible`, dismiss the oldest first. Reducing the
limit also dismisses the oldest excess toasts. History retention and visible
limits are independent; history eviction can reduce the visible count.

Disconnecting Toaster pauses active timers and detaches terminal listeners while
preserving records and remaining time. Remounting resumes retained active toasts
and delivers new pending notifications without resending native records. Terminal
focus starts unknown for each new connection. Changing stores disconnects the old
one and connects the new one. Timer/listener cleanup must survive normal React
effect setup/cleanup cycles without duplicate delivery or leaked handles.

## Rendering And Pointer Interaction

Render through a root portal, following the existing Dialog pattern. Scrolling
containers do not clip the overlay. Use a z-index above the existing Dialog
overlay, no backdrop, and no full-screen pointer-blocking surface. Uncovered
content and gaps remain available to ordinary application interaction.

Use compact bordered cards containing a semantic icon, title, optional
description, optional action, and close control. Reuse the theme, symbols, and
primitive components. Semantic colors/icons follow Alert; `default` uses neutral
styling and a neutral symbol. Native notifications remain plain text.

The stack sits one cell from its selected edges where the viewport permits. Its
default width is 48 terminal columns, clamped to the available viewport. Newest
toast sits nearest the selected corner. Bound the overlay to the viewport on
small terminals; clipping is permitted when content exceeds available height.
Do not add a scrollable toast region or a second height-based notification queue.

Toasts, actions, and close controls are explicitly non-focusable. They register no
keyboard handlers, focus scopes, or control hints and never participate in Tab
traversal. Do not reuse Button as-is: it deliberately makes itself focusable.
Use small local pointer controls built from existing primitives.

Toast mouse presses prevent OpenTUI's automatic focus change and stop propagation
into unrelated application handlers. Preserve the actual focused renderable on
show, hover, click, expiry, and removal. A caller's action may deliberately change
application focus; that behavior belongs to the callback, not Toaster.

Action and close activation require a left-button press followed by release
inside the same control. Crossing child text targets inside that control is
allowed; release outside cancels activation. Hover covers the entire toast,
including its descendant controls. Wheel interaction over a toast does not
scroll unrelated content beneath it.

## Files And Integration

- `packages/tui/src/ui/notifications.ts`: notification types, default store,
  factory, snapshots, lifecycle, and delivery connection.
- `packages/tui/src/ui/notifications.test.ts`: store and delivery behavior.
- `packages/tui/src/ui/components/toast.tsx`: Toaster, root placement, toast
  appearance, and local pointer interaction.
- `packages/tui/src/ui/components/toast.test.tsx`: renderer integration and focus,
  pointer, layout, and hover contracts.
- `packages/tui/src/demos/components.tsx`: Toast section and one demo Toaster,
  using an isolated store for the demo lifetime.

The files describe cohesive ownership, not hard size limits. Split only if a
concrete responsibility genuinely needs its own module. No new dependencies,
barrels, generic overlay framework, or application/server integration is needed.

The demo includes semantic variants, an action that visibly updates demo state,
a persistent notification, a burst exercising overflow, and explicit native/auto
delivery. A delayed auto notification allows switching terminal focus before it
fires. Clean up demo-only delay timers on unmount. Demonstrate history retention
with a count and clear control rather than building a notification-center UI.

## Verification

Use the existing Bun and OpenTUI test facilities. Verify observable contracts
rather than internal implementation shape.

Store tests cover:

- creation and stable read-only snapshots, subscription/unsubscription;
- the focus/mode delivery matrix, unsupported native delivery, declined/throwing
  native sends, and no redelivery on focus/capability changes;
- pre-mount pending delivery and cancelled/cleared pending records;
- timer expiry retaining history, persistent duration, remaining-time hover pause,
  disconnect/remount pause, and cleanup after clear/eviction;
- oldest-first visible overflow and bounded newest-first history;
- configured-value validation before mutation and isolated stores;
- single connected Toaster ownership.

Renderer tests cover:

- semantic appearance, descriptions, and all four corner placements;
- viewport clamping and overlay independence from scrolling parents;
- unchanged keyboard focus and Tab traversal with active toasts;
- pointer action/close success and cancelled releases;
- hover across descendant boundaries and correct timer resumption;
- action exceptions retaining the toast;
- uncovered-content click-through and no wheel propagation beneath a toast;
- connection/listener cleanup on unmount and remount without native resend.

Run focused tests during implementation, then `bun run check` before completion.
That required check covers lint, format, types, tests, production build, and build
smoke verification. Inspect the final diff and confirm the original staged work
has not been restaged or committed.

## Deferred Work

- Read/unread state and durable/history actions.
- Notification-center UI, List/Table implementation, or notification routing from
  application commands and daemon events.
- Cross-process persistence, server protocol changes, and desktop delivery
  acknowledgments.
- Native notification actions, simultaneous native/toast delivery, sound,
  animation, deduplication, notification updating, or promise helpers.
- Toast keyboard navigation or keyboard-action affordances.
