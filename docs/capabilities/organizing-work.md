# Organizing work and shared navigation

Work reading path — **1 of 2** · [Overview](../overview.md) · Next:
[Directory discovery](directory-discovery.md)

**Workspaces own work and terminal surfaces; sessions select from that work.** A
workspace can belong to several sessions. Each session saves its own selected
workspace, category, item, tab and pane, plus its remembered tab per surface and
pane per tab. Deleting a session removes its memberships and navigation without
removing shared workspaces or stopping their shells.

## Items, surfaces and layouts

Every workspace supplies six fixed categories. An item is a root or a direct child
in the same workspace/category. Generic children require generic roots. Coding
items must be registered directories or discovered worktrees, whose groups are
maintained by [directory discovery](directory-discovery.md). Item metadata and
parent relationships are validated when read.

Every item, including a child, may own one surface. The daemon creates that
surface only when requested. A new surface contains a Main tab and a shell pane.
Tabs are ordered, and their saved JSON layouts describe recursive binary splits
with pane-ID leaves. Panes also record their surface owner. Selection and split
commands check that the requested pane belongs to the correct tab and layout.
Only terminal panes and shell restore policies exist today.

Creating an item does not require a terminal. Opening work, selecting it and
starting a shell are separate operations:

- **Create/register an item:** save metadata without a surface or shell.
- **`surface.ensure`:** reuse an existing surface, or create its first tab/pane
  and request a shell start. It does not select a session.
- **`session.openItem`:** ensure the surface and select its destination in one
  transaction. Reopening an existing stopped surface leaves it stopped.
- **`session.navigate`:** validate and save selection without creating resources
  or restarting terminals.
- **`session.step`:** step from current daemon selection, without wrapping at the
  ends. Stepping between items also ensures the destination surface.
- **`tab.create` / `pane.split`:** add a shell pane. Optional activation selects
  the exact new pane in the same transaction.
- **Archive/restore:** change metadata and repair navigation without deleting the
  surface/history or stopping its process.

An archived root makes its children ineligible for selection and input without
changing each child's archived flag. Registration never silently restores an
archived checkout. Selection, typing and paste never restart a stopped pane.

## Navigation is durable; browsing and focus are local

A session's **navigation cursor** is its saved set of selected IDs. Moving a
navigator's highlighted candidate is local browsing; activating it sends a
command to change the cursor. Keyboard focus is local too. Two clients can share
selection and programs while highlighting different candidates or editing
different drafts.

Suppose sessions A and B both contain workspace W. A opens item X and creates its
surface and shell. B then opens X and reuses them. If A moves to another item, B
stays on X and the shell keeps running. A second client attached to A shares A's
new selection, but does not have to move its local keyboard focus. A and B can
also select different tabs of X's surface.

Explicit navigation validates item ancestry and session membership. Invalid
requests fail rather than silently selecting another target. After catalog
changes, the same transaction repairs all session cursors and tab/pane memories.
For example, archiving X repairs both A and B if either selected it. Repair keeps
an eligible selection; otherwise it prefers a surviving next neighbor, then a
previous neighbor.

Each cursor carries a **navigation generation**, a counter that advances when
its selection changes. A command can include the generation it was prepared
against. The daemon checks that value inside the transaction so a delayed command
cannot activate a pane after another client changed the selection.

## Commit before starting processes

`applyCommand` saves the domain change, repairs navigation and applies optional
activation in one synchronous SQLite transaction. It returns the shell-start
work to perform after commit. A transaction failure starts no child; a later
spawn failure leaves a saved pane with a failed status and error text.

The command response identifies the committed revision, while process-status
updates can advance state further. Read the
[command sequence](../foundations/client-synchronization.md#command-order-and-failure)
for the ordering of asynchronous preparation, transaction, publication, shell start
and response. The [terminal interface](terminal-interface.md#keyboard-focus-and-asynchronous-entry)
explains why the TUI also waits for the exact destination to be displayed.

For directories/worktrees, a new tab uses the registered path. A generic item's
first surface can receive an explicit cwd; otherwise creation uses the daemon's
cwd. That supplied cwd belongs to the first pane and is not saved as an item
default. Later generic tabs start in the daemon's cwd. Clients resolve explicit
relative paths before sending them.
Splits use the owned shell's live cwd unless overridden; see
[persistent terminals](persistent-terminals.md#working-directory-and-layout).

## Code References

- [commands.ts](../../packages/server/src/application/commands.ts) (`applyCommand`,
  `ensureSurface`): transactions, returned process effects and creation behavior.
- [navigation.ts](../../packages/server/src/application/navigation.ts)
  (`selectNavigation`, `stepNavigation`, `normalizeNavigation`): selection,
  ordering, remembered tabs/panes and fallback.
- [navigation-store.ts](../../packages/server/src/application/navigation-store.ts):
  persist cursors and per-session memories within the caller's transaction.
- [items.ts](../../packages/server/src/application/items.ts) (`validateItemAncestry`,
  `setItemArchived`, `itemTargetCwd`): item validation, archive and cwd rules.
- [layout.ts](../../packages/server/src/application/layout.ts) (`parseLayout`,
  `splitLayout`): saved split validation and geometry shared with clients.
- [database.ts](../../packages/server/src/persistence/database.ts): relations,
  foreign keys and uniqueness constraints.

Work reading path — **1 of 2** · [Overview](../overview.md) · Next:
[Directory discovery](directory-discovery.md)
