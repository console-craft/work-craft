# Capabilities

[Overview](../overview.md) / Capabilities

Topic 1 of 4

[Parent: Overview](../overview.md) | [Next: Foundations](../foundations/overview.md)

Work Craft organizes work and makes its associated terminals available to disposable
clients. These capabilities share durable identities: opening a registered directory
uses its item's surface, and the interface projects the same saved navigation used by
CLI commands. Their different responsibilities deserve separate explanations.

1. [Work and navigation](work-and-navigation.md) explains sessions, reusable
   workspaces, items, selection, and archival.
2. [Directory catalog](directory-catalog.md) explains how existing directories and
   linked Git worktrees become stable work items.
3. [Terminal workspaces](terminal-workspaces.md) follows surface creation, tabs,
   splits, working directories, shell status, and explicit restart.
4. [Terminal interface](terminal-interface.md) explains client composition, focus,
   command routing, adaptive layout, and reusable UI boundaries.

A creation command can finish after the user has moved elsewhere. The daemon
commits the requested resource under validated context; the TUI separately decides
whether that completion still merits focus or a dialog update. This separation
keeps persisted work and local presentation from becoming competing authorities.
The underlying protocol is owned by
[client coordination](../foundations/client-coordination.md).

[Parent: Overview](../overview.md) | [Next: Foundations](../foundations/overview.md)
