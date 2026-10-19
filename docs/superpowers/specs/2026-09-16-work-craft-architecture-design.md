# Work Craft Architecture Design

## Phase 5 Acceptance / Phase 6 Consolidation Checkpoint (2026-10-19)

The approved [Phase 5 companion](./2026-10-18-tui-component-adoption-phase-5-design.md)
is implemented without changing the single-daemon/disposable-client boundary,
schema or public command/result shapes. The daemon samples the registered shell
PID's live cwd before an omitted-cwd split; explicit API/CLI overrides remain valid.
Unknown/invalid cwd rejects before mutation. Linux uses procfs; macOS uses a
one-second/64-KiB bounded lsof probe. A successful split transaction equalizes
direction-aware shares throughout only its tab, regardless of client dimensions.
Native terminal renderers remain the intentional component-library exception;
Tabs and bottom Alerts do not own daemon runtimes. Reactivate uses the existing
exact-pane explicit restart operation, preserving pane identity/history.
Phase 5 is accepted for progression after independent whole-session/follow-up
review and the split, Hyper+n and explicit-restart focus repairs. The accepted
Oct 19 restyle/status repair passed 1,398 tests, zero failures, build and compiled
smoke on macOS. Output is transparent/undimmed; current geometry, warning colors
and intentional focus/measurement/event bridges are recorded in the canonical
[adoption inventory](./2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries).
Phase 6 implementation and connected review are complete, with no findings or
production changes. Its fresh macOS full check passed 1,399 tests, zero failures,
lint/format/types, build and compiled smoke, exit `0`. The user accepted all
component-adoption work as complete on 2026-10-19. Its tests inject theme context, not a new runtime
preference. No ownership/schema/API changes, Stage 2/shared navigation or additional
Stage 3 operations are introduced. Linux live-cwd, physical-terminal contrast and
long-running listener stability are not certified; existing warnings remain debt.
Earlier dated checkpoints below are historical, not current progression gates.

## Repository-group Follow-up Checkpoint (2026-10-17)

The approved [navigation follow-up](./2026-10-17-coding-navigation-followup-design.md)
implements workspace-scoped canonical Git-common-directory groups in schema 4:
primary checkout parent, linked checkout children, exact requested-item/root IDs,
and metadata-only CLI/API registration. No schema migration, independent-surface
merge, or automatic reset is provided. The daemon still owns discovery, records
and runtimes; disposable clients retain their existing boundaries. TUI entry,
local tab focus and stopped-pane input/restart use the shell's guarded handoff.
Fresh verification is recorded with the follow-up, not inferred from the older
checkpoint below. Independent implementation review and its regression-tested
fixes are complete; human/physical-terminal acceptance remains pending. Shared
navigation and Phase 5 remain out of scope.

## Coding Implementation Checkpoint (2026-10-16)

Schema 3 uses one validated unified items collection. Roots and children own surfaces directly; directory registration/discovery/archive are daemon-owned, with one coalesced five-second refresh lifecycle. Old development schemas are rejected with an explicit-reset instruction, never silently deleted. CLI/TUI are connected disposable clients. See the Coding Navigator spec for current verification progress; human acceptance and Stage 2 remain pending. Historical first-slice records below are preserved.

## Target Amendment And Delivery Status

The accepted [Coding Navigator design](./2026-10-15-coding-navigator-design.md)
updates the target item model and TUI error presentation below. These changes
are implemented under the separately approved plan, with automated checks/review
complete and human acceptance pending. The historical first vertical slice remains recorded later
in this document. Shared session navigation remains architectural Stage 2.

## Goal

Build a local-first terminal application shell that combines structured work organization with persistent terminal workspaces. A user navigates high-level work categories and opens items into execution surfaces containing tabs, terminal panes, and built-in data views.

The codebase must remain small enough for one person to understand and maintain. Prefer a naive local implementation over distributed-system machinery, while preserving user data reliably across client disconnects, server restarts, and machine power loss.

## Product Model

Work Craft is a structured work navigator whose active items can open persistent terminal workspaces. It is not primarily a terminal multiplexer with organization layered on top.

```text
server
└── session
    └── workspace                    Personal / Work / Client A
        └── category                 one of the six fixed categories
            └── work items           roots and optional one-level children
                └── execution surface (optional, at either item level)
                    └── tab
                        └── split tree
                            └── pane
```

### Sessions

A session is a named, durable attachment target. It contains the workspaces and execution state that clients can detach from and later restore.

### Workspaces

A workspace is a high-level context such as Personal, Work, or a client. It is an organizational boundary, not a process or server boundary.

### Categories

Every workspace has the same six fixed top-level categories:

- **Inbox:** unstructured intake of notes, links, ideas, commands, or imported data awaiting triage.
- **Today:** current attention and activity, selected manually or automatically from captured and categorized work.
- **Design:** exploration and shaping of things that may be built, changed, or decided.
- **Implementation:** active execution contexts for making changes, including repositories and worktrees.
- **Collaboration:** work involving other people or shared systems, such as requests, reviews, and discussions.
- **Operations:** ongoing responsibility for systems and environments, including maintenance, deployments, and monitoring.

All six are real categories, but they intentionally do not share one uniform item schema.

### Work Items

Work items share a small common envelope with an optional parent and at most one
child level. Parent and child belong to the same workspace/category. In Coding,
a Project is a root directory item and a worktree is its child item, not a separate
Project entity. Other categories are not forced into artificial Projects.
Category-specific fields live in discriminated JSON payloads until a field needs
indexed querying or sorting, at which point it can become a SQLite column.

```ts
type Item = {
  id: ItemId;
  workspaceId: WorkspaceId;
  category: CategoryKind;
  parentId: ItemId | null;
  kind: ItemKind;
  title: string;
  position: number;
  archived: boolean;
  data: CategorySpecificData;
};
```

This avoids both an oversized universal task schema and a plugin framework with separate storage models.

Processing an Inbox item is an explicit triage operation. It may archive the item, select it for Today, or turn it into category-specific work while retaining a provenance link to the original source. These are a small set of deliberate transitions, not a general workflow engine.

### Execution Surfaces

An item may own one execution surface. A surface contains tabs; each tab contains either one pane or a recursive split tree of panes.

Surfaces are created lazily. Captured or informational items do not need one until the user actively opens them for work.

Non-Coding categories retain generic work items until their specialized experiences
are designed. Coding uses directory/worktree items and their own terminal surfaces,
not a second generic item kind. Opening an item's terminal creates or reuses its
optional surface. This escape hatch allows existing CLI and TUI programs to provide
functionality before a specialized screen exists; surface is not an item kind.

Surfaces remain item-owned at either hierarchy level. Categories do not own PTYs
directly, and a Coding Project needs no synthetic terminal child to own a surface.

### Panes

There are two fundamental pane kinds:

- **Terminal panes:** run shells, Neovim, OpenCode, Taskwarrior, or other CLI/TUI applications through a server-owned PTY.
- **Built-in panes:** render structured server data, such as GitHub or Azure DevOps information, using React components in the TUI.

A pane has a stable durable ID. A live runtime is an in-memory value keyed by that pane ID, so moving a pane does not restart its process. A separate public runtime ID is unnecessary initially.

## Process Architecture

Work Craft uses one local daemon for the current OS user.

```text
                    owner-only Unix socket
          ┌──────────────────┼──────────────────┐
          │                  │                  │
     React TUI          Unix-like CLI      future agents
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                   one Bun server daemon
          ┌──────────────────┼──────────────────┐
          │                  │                  │
    durable model       runtime registry    integrations
      SQLite             PTYs/processes       gh / az
    layouts/state       output buffers      restore adapters
```

The server starts on demand when a client cannot connect, then remains alive after all clients exit. Exclusive socket binding prevents duplicate servers.

The initial product is local-only on macOS and Linux. Work Craft does not implement remote discovery, installation, transport, or authentication. A future user can expose or forward the local service using an external tool such as Tailscale, cloudflared, or SSH, subject to a separate security review.

## Ownership

### Server

The server is the sole authority for:

- sessions, workspaces, categories, and unified work items;
- directory registration, read-only Git worktree discovery, availability, and archival metadata;
- execution surfaces, tabs, panes, and split layouts;
- SQLite persistence and migrations;
- PTYs, child processes, output buffers, and process status;
- category integrations and external CLI execution;
- restore decisions and adapter metadata;
- client subscriptions and event ordering.

### TUI

The React/OpenTUI client:

- composes local UI components over OpenTUI with theme contracts in `ui/`; intentional native boundaries are recorded in the adoption inventory, while Work Craft behavior remains application-owned;
- renders category-specific navigation and root/child work-item screens;
- renders execution surfaces and terminal output;
- sends semantic commands rather than mutating state locally;
- applies ordered server updates;
- owns only transient presentation state such as an open command palette.

The server returns structured data; React controls its presentation. Category screens do not need to resemble terminal multiplexer screens.

### CLI

The CLI is a non-interactive Unix-style API client. It parses arguments, calls the server, emits plain text or JSON, and exits. It contains no TUI framework or duplicate business logic.

Representative commands include `snapshot`; resource creation and execution commands such as `session create`, `surface ensure`, `tab create`, and `pane split`; and grouped daemon lifecycle commands such as `daemon status`, `daemon stop`, and `daemon destroy`.

## Server Components

The daemon is a modular monolith:

```text
Bun server
├── API
│   ├── snapshot query
│   ├── command handler
│   └── WebSocket stream
├── domain
│   ├── sessions and navigation
│   ├── work items and directory discovery
│   └── surfaces and layouts
├── runtime
│   └── PTYs and output buffers
├── persistence
│   └── SQLite
└── restore
    ├── shell
    ├── Neovim
    └── OpenCode
```

These are code boundaries inside one process, not services, mandatory classes, or independently versioned modules.

The existing packages retain these responsibilities:

- `packages/server`: daemon, protocol types, API client, domain logic, SQLite, PTYs, and restore behavior.
- `packages/tui`: React/OpenTUI screens, navigation, category views, and terminal rendering.
- `packages/cli`: argument parsing, API calls, and text or JSON output.

The server package initially exports the protocol types and small API client through a side-effect-free client subpath used by the other packages. A separate shared package is added only if dependency cycles or independent versioning create a concrete need.

## Local API

One `Bun.serve` application listens on an owner-only Unix socket.

```text
GET  /health
GET  /snapshot
POST /command
WS   /stream
```

`POST /command` accepts a discriminated command such as `item.create`, `surface.ensure`, `pane.split`, or `process.restart`. HTTP and WebSocket callers use the same command handler.

The WebSocket carries the initial TUI snapshot, ordered domain updates, process state, terminal output, and interactive terminal input. Messages use JSON initially. Binary framing, codec negotiation, and separate rendering protocols are deferred until profiling demonstrates a need.

Each server start has a new epoch. State messages also carry a monotonically increasing revision. A client that sees a new epoch or a revision gap requests a complete snapshot rather than replaying a durable event log.

If a client falls far behind, the server disconnects it rather than blocking PTY reads or growing an unlimited queue. Reconnection supplies a fresh snapshot and terminal buffers.

## Mutation Flow

All durable mutations follow one path:

```text
TUI or CLI command
  ↓
validate command
  ↓
SQLite transaction
  ↓
update in-memory runtime when needed
  ↓
increment revision
  ↓
broadcast update
```

SQLite stores current authoritative state. Broadcast updates synchronize connected clients but are not an event-sourced persistence model.

## Persistence And Recovery

SQLite runs in WAL mode. Structural changes commit immediately, including hierarchy, layout, restore policy, and application metadata. Terminal output is batch-written by size or a short interval to avoid a transaction per PTY chunk.

The durable database stores:

- stable hierarchy and layout IDs;
- names, ordering, selection, and split trees;
- pane kinds and restore policies;
- working directories;
- application-specific recovery metadata;
- bounded terminal output;
- last-known process state and timestamps.

Memory stores PTY handles, child PIDs, active subscriptions, pending input/output, and live process state.

### Terminal History

Terminal panes keep bounded raw output chunks with per-pane cursors. Reconnects receive missing chunks when available or the current retained buffer otherwise. When history is truncated, the retained output begins with a terminal reset and visible truncation marker.

This favors a small implementation over maintaining a second server-side terminal emulator. A sudden power loss may lose the final unflushed output batch, but previously committed layout, history, and restore instructions remain available.

### Cold Recovery

After a daemon or machine restart, the server:

1. loads the durable hierarchy and layouts;
2. marks previously running panes as interrupted;
3. restores bounded output with a visible restart separator;
4. resolves each pane's restore policy into a process spawn specification;
5. starts eligible PTYs and processes once;
6. broadcasts normal status updates as panes become ready.

Work Craft restores useful semantic state, not arbitrary Unix process memory.

The restore policy model supports:

- **Shell:** start a fresh configured shell in the saved working directory.
- **Neovim:** launch in the saved working directory and let the user's Neovim session plugin, swap files, and configuration restore editor state.
- **OpenCode:** resume a known native session ID when available; otherwise launch normally in the saved working directory.

Adapters are plain functions from durable pane data to an argument vector, working directory, and environment. They are not a plugin framework.

The first vertical slice implements only shell restoration. Neovim and OpenCode policies are added with their metadata integrations in later increments.

No automatic process restart loop runs after the one cold-recovery attempt. Further retries are user-triggered.

## Failure Handling

- A missing working directory preserves the pane and history, reports the path, and allows the user to select another directory.
- A missing executable preserves restore metadata and allows retry after installation or configuration.
- A disappeared server socket makes clients reconnect with bounded backoff, then start a new server if no server remains.
- A stale socket is removed only after a failed health check and successful exclusive startup decision.
- A failed SQLite mutation rejects the command without applying its in-memory counterpart.
- A failed database migration stops with an actionable error and never silently resets data.
- A slow client is disconnected and resynchronized rather than blocking runtime output.
- A failed external integration keeps its source identity and persistent failure
  indicator, reports its failure in the TUI status bar, and does not retry indefinitely
  or crash the server. Repeated identical discovery failures are deduplicated.

TUI failure ownership and message placement are separate: Work Craft operational
messages use the source-labelled status bar; client/server field validation stays
beside its field. Unavailable items and failed panes retain compact local indicators,
not duplicate full error banners. Reporting never steals focus or unmounts unrelated
panes. Child-program output stays in its terminal; CLI and pre-TUI fatal failures
use stderr. See the Coding design's error policy for the approved scope.

## Verification Strategy

The initial suite stays small and exercises architectural boundaries:

1. A domain test executes representative commands against temporary SQLite and verifies the resulting snapshot.
2. A PTY test starts a shell, sends input, observes cursor-tagged output, and verifies output remains after process exit.
3. A reconnect test disconnects a client, mutates state, reconnects, and receives a coherent snapshot.
4. A cold-recovery test creates a hierarchy and pane, stops and restarts the daemon, and verifies layout, history, interruption marker, and restored shell.
5. A restore-adapter test turns persisted shell metadata into the expected spawn specification; Neovim and OpenCode cases are added with those adapters.
6. A CLI smoke test exercises the real local API through resource creation, snapshot, execution-surface operations, and daemon shutdown.

Broad mock infrastructure, exhaustive endpoint permutations, and visual snapshot tests are excluded initially.

## First Vertical Slice (Historical)

This records the pre-unified-item implementation, not a requirement to retain
separate Projects or the old surface item kind. The user permits discarding its
saved development state for the Coding redesign; no normal-startup silent database
reset or deletion of source work/project files is authorized by that exception.

The first useful implementation contains:

- one daemon and owner-only Unix socket;
- SQLite migrations and cold recovery;
- session and workspace navigation;
- the six fixed category entries;
- generic projects, items, and surface items;
- tabs, split layouts, and terminal panes;
- shell restoration and bounded terminal history;
- a resource-oriented CLI for snapshots, hierarchy creation, surface/tab/pane operations, and daemon lifecycle operations;
- a React/OpenTUI shell that reaches and operates those capabilities.

Category-specific screens, `gh` and `az` views, Neovim and OpenCode metadata integration, remote access, and agent automation follow as separate increments. Generic surface items keep the product useful while those richer capabilities are developed.

## Deliberate Exclusions

- Per-session daemons.
- Automatic installation on remote machines.
- Built-in SSH, remote discovery, or machine federation.
- A general plugin architecture.
- Event sourcing.
- Binary protocol and codec negotiation.
- Arbitrary-process checkpointing.
- Generic automatic rerunning of arbitrary commands.
- A separate shared package without demonstrated need.
