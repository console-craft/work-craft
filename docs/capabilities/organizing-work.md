# Organizing work and shared navigation

**Sessions are attachment profiles, not owners of terminal processes.** Workspaces
can belong to several sessions; each session stores its own authoritative
workspace/category/item/tab/pane cursor and remembers tabs per surface and panes
per tab. Deleting a session removes its memberships and navigation, not shared
workspaces or their shells.

## Items, surfaces and layouts

A workspace supplies six fixed categories. An item is either a root or a direct
child in the same workspace/category. Generic children require generic roots;
directory/worktree groups are maintained by [directory discovery](directory-discovery.md).
Persisted item discriminants, metadata and ancestry are validated when read.

Every item, including a child, may lazily own one surface. A new surface contains
one Main tab and one shell pane. Tabs are ordered; their durable JSON layouts are
recursive binary splits with pane-ID leaves. Panes belong to the surface and must
resolve to the correct tab/layout when selected or split. Only terminal panes and
shell restore policies exist today.

| Operation                   | Structural and runtime consequence                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create/register an item     | Save metadata; no surface or shell required                                                             |
| `surface.ensure`            | Reuse the surface, or create its first tab/pane and spawn a shell; does not select a session            |
| `session.openItem`          | Ensure the surface and select its destination in one transaction                                        |
| `session.navigate`          | Resolve and save selection; does not create or restart terminals                                        |
| `session.step`              | Step from current daemon selection without wrapping; item stepping also ensures the destination surface |
| `tab.create` / `pane.split` | Add a shell pane; optional activation selects the exact new destination atomically                      |
| Archive/restore an item     | Toggle metadata and normalize navigation; do not delete its surface/history or stop its process         |

An archived root makes its descendants ineligible for selection and input without
rewriting each child's archived flag. Registration never silently restores an
archived checkout. Ordinary selection and typing never reactivate a stopped pane.

## Navigation is durable; browsing and focus are not

Two clients attached to one session see the same authoritative selection and
programs. They can still have different native focus, navigator candidates,
filters and drafts. Merely highlighting a candidate is not a shared selection.
Different sessions may select different tabs of the same underlying surface.

Explicit navigation validates the complete ancestry and session membership;
invalid requests are rejected rather than silently retargeted. Catalog mutations
normalize affected cursors and memories in the same transaction. When a selected
entry disappears, normalization prefers a surviving next neighbor, then a previous
one. Navigation generations advance when the cursor changes, allowing commands
prepared against an older selection to fail safely.

## Commit before effects

```text
HTTP or attached WebSocket command
  -> parse and validate
  -> prepare asynchronous Git/cwd work, if needed
  -> revalidate attachment and guarded navigation
  -> transaction: mutate + normalize + optional activation
  -> publish revision and reconcile geometry
  -> start shell effects; publish subsequent process status
```

`applyCommand` returns effects instead of running processes inside the transaction.
A failed transaction runs no effects. A failed post-commit spawn records a failed
pane with error text. The command response's revision identifies the structural
commit and can precede status revisions. The CLI checks returned panes for failed
startup before reporting success; the TUI also observes authoritative status.

For directories/worktrees, a new tab uses the item's registered path. For generic
items, a supplied surface cwd is honored; otherwise the daemon's cwd is used.
Clients resolve explicit relative paths before sending them. Splits inherit the
owned shell's live cwd unless explicitly overridden, as described in
[persistent terminals](persistent-terminals.md#working-directory-and-layout).

## Code References

- [commands.ts](../../packages/server/src/application/commands.ts) (`applyCommand`,
  `ensureSurface`): transaction boundary, domain effects and creation behavior.
- [navigation.ts](../../packages/server/src/application/navigation.ts)
  (`selectNavigation`, `stepNavigation`, `normalizeNavigation`): cursor rules and fallback.
- [navigation-store.ts](../../packages/server/src/application/navigation-store.ts):
  persist cursors and per-session memories.
- [items.ts](../../packages/server/src/application/items.ts) (`validateItemAncestry`,
  `setItemArchived`, `itemTargetCwd`): item validation and eligibility.
- [layout.ts](../../packages/server/src/application/layout.ts) (`parseLayout`,
  `splitLayout`): validated split structure and geometry shared with clients.
- [database.ts](../../packages/server/src/persistence/database.ts): relations,
  foreign keys and uniqueness constraints.
