# Directory registration and Git discovery

Work reading path — **2 of 2** · Previous:
[Organizing work](organizing-work.md) · [Overview](../overview.md)

**Work Craft records existing directories; it does not manage Git checkouts.** The
daemon resolves paths to their filesystem targets, inspects Git read-only and
updates repository groups within each workspace. Registration and refresh do not
create or delete worktrees, change branches or move terminal ownership to another
checkout.

## Registering a target

Clients expand `~` and resolve relative paths in their own working directory
(cwd). The daemon requires an absolute, readable/searchable directory. It resolves
symbolic links to a canonical filesystem path before inspecting the directory.
Plain directories become root Coding items. For a supported Git checkout, the
primary checkout becomes the group root and linked worktrees become children.
Registering a linked checkout returns **that checkout's** `itemId` as well as the
group's `rootItemId`, not merely the primary directory.

```text
client path -> canonical directory -> read-only Git inspection
                                         |
                          workspace-local group transaction
                                         |
                            exact requested checkout item
```

Registration is metadata-only at the CLI/API boundary. The TUI explicitly follows
successful registration with opening the requested item's surface.

Git inspection uses `git --no-optional-locks`, the NUL-delimited machine-readable
worktree listing and the common Git metadata directory shared by the checkouts.
Git-local environment variables are removed from the subprocess so an invoking
repository cannot redirect inspection. A shared
two-second Git deadline and bounded output prevent an inspection from waiting
indefinitely; shutdown aborts and drains outstanding discovery.

## Identity, refresh and failure

The canonical path identifies a checkout. A repository group also records the
path to its shared Git metadata directory. These identities are unique within a
workspace, so two workspaces can organize the same repository independently.

Discovery starts after daemon recovery. Passes do not overlap; the next pass is
scheduled five seconds after the previous one completes. In-flight inspections of
one path are shared. After asynchronous inspection, the daemon checks that the
root or child still exists with the same recorded path and repository identity
before updating it. Metadata changes and navigation repair commit together.

- Missing/pruned worktrees become unavailable records, not deleted panes or history.
- A transient Git error retains last-known repository membership and branch data
  and records a discovery error rather than converting a repository to plain data.
- A trusted linked checkout can refresh a group whose primary checkout is missing.
- Conflicting checkout/group identity requires explicit resolution; discovery does
  not merge groups or retarget existing live terminals.
- Archived targets require explicit restoration. Refresh does not revive them.

Bare repositories without a `.git` checkout marker are treated as plain
directories. Linked worktrees backed only by a bare repository, and layouts lacking
a supported primary checkout, are rejected instead of guessed. Renaming/replacing
a checkout does not give its old record a new identity or move its terminals.
Unavailable records for the old path may remain.

Directory availability controls creation of new terminal resources. It is not a
reason to kill a previously running process. Cwd failure at shell startup is
reported on the pane, not repaired by changing its saved target behind the user.

## Code References

- [directories.ts](../../packages/server/src/application/directories.ts)
  (`canonicalDirectoryPath`, `inspectDirectory`, `parseWorktrees`): filesystem/Git
  validation and bounded subprocess inspection.
- [directory-discovery.ts](../../packages/server/src/application/directory-discovery.ts)
  (`createDirectoryDiscovery`): shared inspections, refresh scheduling, stale-result
  checks and cancellation/draining.
- [items.ts](../../packages/server/src/application/items.ts) (`registerDirectory`,
  `reconcileDirectoryScan`, `isTrustedGroupScan`): group identity and non-destructive updates.
- [app.ts](../../packages/server/src/application/app.ts) (`execute`): prepare
  registration before the synchronous domain transaction.

Work reading path — **2 of 2** · Previous:
[Organizing work](organizing-work.md) · [Overview](../overview.md)
