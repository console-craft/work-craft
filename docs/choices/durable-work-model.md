# Durable work model

[Overview](../overview.md) / [Choices](overview.md) / Durable work model

Topic 3 of 3

[Parent: Choices](overview.md) | [Previous: Terminal authority](terminal-authority.md)

Workspaces own reusable work while sessions own membership and shared selection.
Items own surfaces; sessions do not clone terminals. That model makes several
clients in one session move together and several sessions in one workspace select
independently, while all still access the same underlying pane processes.

## Shared selection versus private presentation

A durable session cursor and tab/pane memories live in SQLite. Attachment chooses
which cursor a client follows. Local focus/filter/drafts live in the TUI, and
input stamps bind interaction to the current shared context. Removing a workspace
membership or deleting a session does not destroy the shared workspace's work.

**Changeability — Coordinated change:** Making navigation private per client would
change cursor storage, attachment semantics, CLI selection targets, snapshot
shape, activation checks, input stamps, shell derivation, and behavior expected by
shared-session acceptance tests. Changing the sharing unit to give each session
its own shells is broader: surface/pane ownership and persistence identity also
need redesign and saved-state migration.

## Fixed categories and shallow item hierarchy

Categories are a code-defined list with a persisted enum; Coding's stored name is
`implementation`. Generic items belong outside Coding; directory roots and
worktree children belong inside it. An item has at most one root parent in the
same workspace/category. Directory identity and Git common-directory uniqueness
are enforced within a workspace. There is no plugin/category registry.

**Changeability — Coordinated change:** Adding a category or item kind affects
protocol validation, schema checks, item readers, category/navigation projections,
TUI creation/labels/filtering, CLI parsing, and fixtures. Arbitrary hierarchy is
also a coordinated behavioral change because selection, archival ancestry,
navigator ordering, directory grouping, and authorization all assume one child
level. Existing stored rows may remain usable, but schema compatibility must be
addressed explicitly before changing constraints.

## Durable schema without a migration chain

`openDatabase` initializes version 1 for empty state and refuses incompatible
versions or an unversioned populated database. JSON payloads and layouts are still
validated at read time; valid SQLite text is not sufficient application validity.

**Changeability — Coordinated change:** Introducing schema migrations requires an
ordered migration policy, transaction/rollback handling, compatibility decisions
for compiled clients and the daemon, preservation of byte/grid history, and
verification with representative saved databases. Once a migration rewrites user
state, rollback can require another data migration. The current explicit destroy
path is not a substitute for preserving production state during evolution.

## Catalog discovery without checkout mutation

Git integration reads existing worktrees and preserves durable identity when a
scan fails. The catalog is not the filesystem owner. It does not transfer a
surface to a new checkout because a canonical path now points elsewhere.

**Changeability — Coordinated change:** Adding worktree creation/deletion or branch
mutation would introduce filesystem side effects, failure recovery, ownership and
confirmation semantics beyond the current inspection transaction. Those operations
would need their own lifecycle rather than being added to metadata refresh.

## Source basis

[database.ts](../../packages/server/src/persistence/database.ts),
[navigation.ts](../../packages/server/src/application/navigation.ts),
[items.ts](../../packages/server/src/application/items.ts),
[directory discovery](../../packages/server/src/application/directory-discovery.ts),
and [TUI state](../../packages/tui/src/shell/state.ts) establish these commitments.
The authoritative behavior explanations are
[work and navigation](../capabilities/work-and-navigation.md) and
[directory catalog](../capabilities/directory-catalog.md).

[Parent: Choices](overview.md) | [Previous: Terminal authority](terminal-authority.md)
