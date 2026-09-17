# CLI Feature Completeness Design

## Goal

Expand the Work Craft CLI from the first-slice commands into an automation-first client for every current non-interactive server capability. The CLI should let scripts and agents create fixture data and exercise the same durable operations as the TUI while the TUI is redesigned.

The CLI remains a disposable client. It parses arguments, calls the existing server API, prints plain text or JSON, and exits. The server continues to own validation, transactions, persistence, terminal runtimes, and recovery.

## Scope

This increment exposes the server's existing snapshot query and command set through resource-oriented CLI commands. It does not add server domain operations, persistence behavior, or interactive terminal streaming.

The current top-level `list`, `ensure`, `status`, `stop`, and `destroy` spellings are replaced rather than retained as aliases. Work Craft has no users requiring compatibility, and keeping duplicate names would enlarge a new API before it has stabilized.

Missing update, delete, move, and reorder operations remain out of scope until the TUI overhaul or another concrete workflow requires corresponding server commands.

## Command Model

Commands follow `<resource> <operation>`. Relationships needed to create a new resource use explicit flags; IDs of existing target resources are positional when the operation acts on one.

```text
work-craft snapshot [--json]

work-craft session create --name <name> [--json]
work-craft workspace create --session <id> --name <name> [--json]
work-craft project create --workspace <id> --category <kind> --name <name> [--json]
work-craft item create --project <id> --kind <generic|surface> --title <title>
                       [--data <json-object>] [--json]

work-craft surface ensure (--item <id> | --project <id>)
                          [--cwd <path>] [--json]
work-craft surface select-tab <surface-id> <tab-id> [--json]

work-craft tab create --surface <id> --title <title> [--json]

work-craft pane split <pane-id> --direction <horizontal|vertical>
                      [--cwd <path>] [--json]
work-craft pane restart <pane-id> [--json]

work-craft daemon status [--json]
work-craft daemon stop [--json]
work-craft daemon destroy --force [--json]
```

The six valid project categories are `inbox`, `today`, `design`, `implementation`, `collaboration`, and `operations`.

## Server Mapping

Each mutating CLI command constructs exactly one existing protocol command.

| CLI command                | Server operation     |
| -------------------------- | -------------------- |
| `session create`           | `session.create`     |
| `workspace create`         | `workspace.create`   |
| `project create`           | `project.create`     |
| `item create`              | `item.create`        |
| `surface ensure --item`    | `surface.ensure`     |
| `surface ensure --project` | `surface.ensureHere` |
| `surface select-tab`       | `surface.selectTab`  |
| `tab create`               | `tab.create`         |
| `pane split`               | `pane.split`         |
| `pane restart`             | `process.restart`    |
| `daemon stop`              | `daemon.stop`        |
| `daemon destroy`           | `daemon.destroy`     |

`snapshot` calls the existing snapshot query. `daemon status` reads a coherent snapshot and health response using the existing bounded retry behavior.

The CLI names need not reproduce protocol names literally. `pane restart` names the durable resource whose process is restarted. `surface select-tab` reflects that active-tab selection belongs to the surface. The project form of `surface ensure` is the CLI spelling for the existing project-terminal escape hatch; the resulting surface remains item-owned.

## Resource Semantics

The durable execution hierarchy remains:

```text
item
└── zero or one surface
    ├── active tab selection
    ├── tabs
    │   └── split layout referencing pane IDs
    └── panes
        └── optional live terminal process
```

An item can own at most one surface, so `surface ensure` is idempotent: it returns the existing surface or creates the surface with its initial tab and terminal pane. Tabs are plural children without a unique semantic key, so `tab create` always appends a tab. Panes own process status and restore policy, so restart targets a pane rather than a tab or surface.

## Argument Parsing

`packages/cli/src/args.ts` continues to return a discriminated `CliArgs` value. It recognizes the resource and operation first, then uses Bun's Node-compatible `util.parseArgs` for leaf-command options. No argument-parsing dependency is added.

Parsing enforces:

- required flags and positional IDs;
- exactly one of `--item` or `--project` for `surface ensure`;
- known category and split-direction values;
- one non-array JSON object for `item create --data`;
- no duplicate or unknown options;
- `--force` for `daemon destroy`.

Inputs use explicit IDs only. Name lookup, fuzzy matching, an implicit current workspace, input manifests, stdin payloads, and `@file` expansion are excluded.

## Output Contract

Plain text is the default. `--json` writes exactly one compact JSON value followed by a newline.

Mutation JSON contains the server command's `result`, not the HTTP response envelope. Query JSON contains the complete snapshot or daemon status value. Successful commands write only to stdout.

Scripts may rely only on fields guaranteed by the corresponding command. In particular, `surface ensure` guarantees `itemId` and `surfaceId`. `tabId` and `paneId` are present when the operation creates the initial resources but are not guaranteed when the surface already exists. Scripts that need the current tabs, layout, or panes obtain them from `snapshot --json`.

Plain mutation output reports the relevant returned IDs or a concise lifecycle confirmation. The existing hierarchy formatter becomes the plain representation of `snapshot`; its JSON representation remains the complete server snapshot.

## Failures And Exit Status

The CLI uses three exit statuses:

- `0`: success;
- `1`: daemon, server, transport, runtime, or completion-confirmation failure;
- `2`: invalid CLI usage.

Failures write one concise plain-text message to stderr and nothing to stdout. `--json` does not change error formatting; scripts branch on exit status rather than parsing error prose.

Normal commands start and recover the daemon on demand. `daemon destroy --force` starts the daemon in non-recovery mode when necessary, sends `daemon.destroy`, and succeeds only after the database, WAL/SHM files, socket, and lock have disappeared. Requiring `--force` preserves non-interactive behavior while making irreversible deletion explicit.

## CLI Implementation

The implementation stays in the existing CLI modules:

- `args.ts` owns command-line parsing and usage text.
- `main.ts` maps parsed arguments to `WorkCraftClient` calls, controls daemon startup mode, and routes output.
- `format.ts` retains snapshot and status formatting and adds only the small plain-text formatting needed for mutation results.

The implementation does not add command classes, a command registry, a module per command, or duplicated domain validation. The server remains authoritative when an ID does not exist, a relationship is invalid, or a runtime action cannot be completed.

## Seeding Workflow

Fixture scripts use an isolated state directory and chain IDs from JSON results:

```sh
export WORK_CRAFT_HOME=/tmp/work-craft-fixture
work-craft daemon destroy --force

session_id=$(work-craft session create --name Main --json | jq -r .id)
workspace_id=$(work-craft workspace create --session "$session_id" --name Work --json | jq -r .id)
```

Seeds are one-shot against isolated state. The CLI does not introduce upsert, reconciliation, reset, or manifest semantics. `daemon destroy --force` provides the clean lifecycle required by this workflow.

## Verification

Argument tests cover valid and invalid forms through compact tables, including:

- every resource and operation;
- required, duplicate, and unknown options;
- mutually exclusive surface targets;
- category and direction validation;
- JSON object parsing;
- mandatory destroy confirmation.

The real-daemon CLI smoke test creates a session, workspace, project, and item using CLI JSON results; ensures a surface; creates and selects a tab; splits and restarts a pane; and verifies the resulting snapshot. Representative commands verify plain output and JSON output without duplicating every formatting permutation.

Destructive tests always set an isolated `WORK_CRAFT_HOME` and verify removal of the database, WAL/SHM files, socket, and lock. Existing server tests remain authoritative for transactions, ownership constraints, layouts, runtime behavior, recovery, and destroy semantics.

The completed implementation must pass `bun run check`.

## Deliberate Exclusions

- Backward-compatible aliases for the first-slice CLI names.
- New server commands or persistence behavior.
- Update, delete, move, and reorder operations not already supported by the server.
- Name-based selectors or implicit context.
- Interactive terminal attachment, input, resize, or output streaming.
- Batch commands, seed manifests, upserts, or reconciliation.
- Additional CLI frameworks or dependencies.
- Structured JSON errors.
