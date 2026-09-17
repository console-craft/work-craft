# Server Source Organization Design

## Goal

Reorganize `packages/server/src` so its existing architectural boundaries are visible from the directory structure. Preserve all current behavior, package exports, protocol contracts, persistence semantics, process lifecycle behavior, and client-facing APIs.

This is a structural refactor of the existing modular monolith. It does not introduce new runtime abstractions, split the server into services, or change ownership between the server, TUI, and CLI.

## Constraints

- Preserve the local-first, single-daemon architecture.
- Preserve `@work-craft/server` and `@work-craft/server/client` exports.
- Preserve HTTP routes, WebSocket messages, commands, responses, snapshots, and error behavior.
- Preserve the SQLite schema, migrations, durability settings, and database location.
- Preserve daemon startup, auto-start, locking, recovery, and shutdown behavior.
- Preserve runtime process handling and terminal history behavior.
- Keep `client.ts`, `index.ts`, and `main.ts` as root entrypoints.
- Keep tests colocated with the source they exercise, except cross-cutting acceptance tests.
- Do not add generic `utils`, `helpers`, `shared`, repository, service, or adapter abstractions.

## Target Structure

```text
packages/server/src/
├── api/
│   ├── http.test.ts
│   ├── http.ts
│   ├── protocol.test.ts
│   └── protocol.ts
├── application/
│   ├── app.ts
│   ├── commands.test.ts
│   ├── commands.ts
│   ├── layout.test.ts
│   ├── layout.ts
│   ├── recovery.test.ts
│   └── snapshot.ts
├── daemon/
│   ├── lifecycle.test.ts
│   ├── lifecycle.ts
│   ├── paths.test.ts
│   └── paths.ts
├── persistence/
│   ├── database.test.ts
│   └── database.ts
├── terminal/
│   ├── history.test.ts
│   ├── history.ts
│   ├── restore.ts
│   ├── runtime.test.ts
│   └── runtime.ts
├── acceptance.test.ts
├── client.ts
├── index.ts
└── main.ts
```

## Capability Ownership

### API

`api/` owns the server's public contract and transport boundary.

- `protocol.ts` defines commands, responses, snapshots, stream messages, protocol errors, structural validation, and protocol byte encoding.
- `http.ts` adapts HTTP and WebSocket requests to the in-process application API.

`protocol.ts` answers whether external data is a structurally valid Work Craft message. It does not query durable state or execute commands.

### Application

`application/` owns server use cases and coordination of durable domain behavior.

- `app.ts` coordinates command execution, revisions, subscriptions, runtime effects, process status, and cold recovery.
- `commands.ts` applies validated commands transactionally and returns private runtime effects.
- `snapshot.ts` projects authoritative SQLite state into the public snapshot contract.
- `layout.ts` performs the pure layout transformation used by pane commands.

`commands.ts` answers what a valid command does. It performs semantic checks that require server state, such as verifying that referenced sessions, workspaces, projects, surfaces, tabs, and panes exist.

The command boundary remains:

```text
unknown input
  ↓
api/protocol.ts: structural validation
  ↓
validated Command
  ↓
application/commands.ts: semantic validation and transaction
  ↓
CommandResult + private DomainEffect[]
```

### Daemon

`daemon/` owns process-level startup policy and filesystem locations.

- `paths.ts` resolves the state directory, database path, Unix socket, and daemon lock from environment and platform conventions.
- `lifecycle.ts` owns singleton locking, stale takeover, socket ownership, startup ordering, signals, and graceful shutdown.

Path resolution is daemon policy, not a generic utility.

### Persistence

`persistence/` owns SQLite setup and schema migration.

- `database.ts` opens SQLite, configures durability, and applies migrations.

The initial reorganization keeps migrations in `database.ts`. A migration directory or additional persistence modules should be introduced only when that file becomes difficult to navigate.

### Terminal

`terminal/` owns persistent terminal execution behavior.

- `runtime.ts` owns live PTYs, child processes, input, resize, process-tree shutdown, and process status callbacks.
- `restore.ts` converts durable restore metadata into validated process spawn specifications.
- `history.ts` buffers, persists, truncates, flushes, and reads terminal output.

These files remain separate because they own distinct state and failure modes. In particular, restore policy resolution and output history persistence do not form one responsibility.

## Root Entrypoints

The root contains only entrypoints and cross-cutting acceptance coverage.

- `client.ts` is the client SDK used by the CLI, TUI, and other local consumers. Its package export remains `@work-craft/server/client`.
- `main.ts` is the daemon executable entrypoint.
- `index.ts` is the package-root export surface.
- `acceptance.test.ts` exercises the complete server process and therefore remains cross-cutting.

Keeping `client.ts` beside `main.ts` preserves its source-mode daemon resolution through `new URL("./main.ts", import.meta.url)`.

## File Mapping

| Current file         | Target file               |
| -------------------- | ------------------------- |
| `app.ts`             | `application/app.ts`      |
| `commands.ts`        | `application/commands.ts` |
| `layout.ts`          | `application/layout.ts`   |
| `snapshot.ts`        | `application/snapshot.ts` |
| `http.ts`            | `api/http.ts`             |
| `protocol.ts`        | `api/protocol.ts`         |
| `lifecycle.ts`       | `daemon/lifecycle.ts`     |
| `paths.ts`           | `daemon/paths.ts`         |
| `database.ts`        | `persistence/database.ts` |
| `history.ts`         | `terminal/history.ts`     |
| `restore.ts`         | `terminal/restore.ts`     |
| `runtime.ts`         | `terminal/runtime.ts`     |
| `client.ts`          | `client.ts`               |
| `index.ts`           | `index.ts`                |
| `main.ts`            | `main.ts`                 |
| `acceptance.test.ts` | `acceptance.test.ts`      |

Colocated tests move with their corresponding source files. `recovery.test.ts` moves under `application/` because it exercises `app.ts` cold recovery across persistence and terminal boundaries.

## Dependency Shape

The reorganization preserves the existing acyclic dependency graph:

```text
client.ts ───────────────→ api/protocol.ts
   │
   └────────────────────→ daemon/paths.ts

api/http.ts ────────────→ application/app.ts
   └────────────────────→ api/protocol.ts

application/app.ts ─────→ application/commands.ts
   ├────────────────────→ application/snapshot.ts
   ├────────────────────→ terminal/history.ts
   ├────────────────────→ terminal/runtime.ts
   └────────────────────→ api/protocol.ts

daemon/lifecycle.ts ────→ application/app.ts
   ├────────────────────→ api/http.ts
   └────────────────────→ persistence/database.ts

terminal/runtime.ts ────→ terminal/restore.ts
   └────────────────────→ api/protocol.ts
```

No dependency-inversion interfaces, factories, registries, or repository wrappers are added. Direct imports remain appropriate inside the single-process modular monolith.

## Compatibility

The package export paths remain unchanged:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.ts"
  }
}
```

`index.ts` updates only its internal relative export paths. `client.ts` continues to re-export the same client-safe protocol types and byte decoder. CLI and TUI imports require no changes because they use `@work-craft/server/client`.

Internal relative imports in moved modules, root entrypoints, and server tests must be updated to the new locations. Existing direct imports of `src/client.ts` and `src/main.ts` from the root entrypoint, build smoke test, and CLI tests remain stable because both files stay at the package root.

## Verification

The refactor is complete when:

1. All mapped source files and their colocated tests are in the agreed capability directories.
2. Existing package exports resolve without consumer changes.
3. No protocol, database, runtime, or process behavior has changed.
4. The full existing test suite passes from the reorganized paths.
5. Type checking, linting, formatting checks, production build, and build smoke test pass through `bun run check`.

No new behavioral tests are required solely for file moves. Existing tests provide the compatibility check; any necessary test edits are limited to imports and path assumptions.

## Deliberate Exclusions

- Splitting command handling by product feature.
- Splitting domain models from public protocol DTOs.
- Creating category-specific feature directories before those features exist.
- Introducing a generic `utils.ts`, `helpers.ts`, or shared folder.
- Splitting database migrations into separate files before growth requires it.
- Combining terminal restoration with terminal history.
- Renaming the public client entrypoint.
- Changing runtime behavior while moving files.
