# Server Source Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `packages/server/src` into capability-oriented directories without changing behavior or public contracts.

**Architecture:** Keep the server as one modular monolith while making its existing API, application, daemon, persistence, and terminal boundaries visible in the filesystem. Move files and their colocated tests incrementally, updating only relative imports and test path assumptions; keep `client.ts`, `index.ts`, `main.ts`, and `acceptance.test.ts` at the source root.

**Tech Stack:** Bun 1.4, TypeScript 7, `bun:test`, `bun:sqlite`, Git file moves

**Spec:** `docs/superpowers/specs/2026-09-17-server-source-organization-design.md`

## Global Constraints

- Preserve the local-first, single-daemon architecture.
- Preserve `@work-craft/server` and `@work-craft/server/client` exports.
- Preserve HTTP routes, WebSocket messages, commands, responses, snapshots, and error behavior.
- Preserve the SQLite schema, migrations, durability settings, and database location.
- Preserve daemon startup, auto-start, locking, recovery, and shutdown behavior.
- Preserve runtime process handling and terminal history behavior.
- Keep `client.ts`, `index.ts`, and `main.ts` as root entrypoints.
- Keep tests colocated with the source they exercise, except `acceptance.test.ts`.
- Do not add generic `utils`, `helpers`, `shared`, repository, service, or adapter abstractions.
- Do not split or combine existing implementation modules; this plan changes locations and imports only.
- Use existing tests as characterization coverage. File moves do not require new behavioral tests.
- Run all commands from the repository root.

---

### Task 1: Move the API Boundary

**Files:**

- Move: `packages/server/src/protocol.ts` → `packages/server/src/api/protocol.ts`
- Move: `packages/server/src/protocol.test.ts` → `packages/server/src/api/protocol.test.ts`
- Move: `packages/server/src/http.ts` → `packages/server/src/api/http.ts`
- Move: `packages/server/src/http.test.ts` → `packages/server/src/api/http.test.ts`
- Modify: `packages/server/src/acceptance.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/client.ts`
- Modify: `packages/server/src/commands.test.ts`
- Modify: `packages/server/src/commands.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/layout.ts`
- Modify: `packages/server/src/recovery.test.ts`
- Modify: `packages/server/src/restore.ts`
- Modify: `packages/server/src/runtime.test.ts`
- Modify: `packages/server/src/runtime.ts`
- Modify: `packages/server/src/snapshot.ts`

**Interfaces:**

- Consumes: Existing exports from `protocol.ts` and `http.ts` without signature changes.
- Produces: `api/protocol.ts` as the shared public contract and `api/http.ts` as the server transport adapter.

- [ ] **Step 1: Run the API characterization tests before moving files**

Run:

```bash
bun test packages/server/src/protocol.test.ts packages/server/src/http.test.ts
```

Expected: both existing test files pass.

- [ ] **Step 2: Create the capability directory and preserve file history**

Run:

```bash
mkdir -p packages/server/src/api
git mv packages/server/src/protocol.ts packages/server/src/api/protocol.ts
git mv packages/server/src/protocol.test.ts packages/server/src/api/protocol.test.ts
git mv packages/server/src/http.ts packages/server/src/api/http.ts
git mv packages/server/src/http.test.ts packages/server/src/api/http.test.ts
```

- [ ] **Step 3: Update imports inside the moved API files**

In `packages/server/src/api/http.ts`, use:

```ts
import type { WorkCraftApp } from "../app.ts";
import { parseClientMessage, ProtocolError } from "./protocol.ts";
import type { Command } from "./protocol.ts";
```

In `packages/server/src/api/http.test.ts`, use:

```ts
import { createApp } from "../app.ts";
import { createClient } from "../client.ts";
import { openDatabase } from "../database.ts";
import { TerminalHistory } from "../history.ts";
import { startHttpServer } from "./http.ts";
import { decodeBytes, type ServerMessage, type Snapshot } from "./protocol.ts";
```

Keep `packages/server/src/api/protocol.test.ts` importing `./protocol.ts`.

- [ ] **Step 4: Redirect root modules and tests to the API contract**

Replace imports from `./protocol.ts` with `./api/protocol.ts` in:

```text
packages/server/src/acceptance.test.ts
packages/server/src/app.ts
packages/server/src/client.ts
packages/server/src/commands.test.ts
packages/server/src/commands.ts
packages/server/src/layout.ts
packages/server/src/recovery.test.ts
packages/server/src/restore.ts
packages/server/src/runtime.test.ts
packages/server/src/runtime.ts
packages/server/src/snapshot.ts
```

Update the relevant exports in `packages/server/src/index.ts`:

```ts
export * from "./api/http.ts";
export * from "./api/protocol.ts";
```

Do not change exported names, protocol parsing, message types, or HTTP behavior.

- [ ] **Step 5: Verify the API move**

Run:

```bash
bun test packages/server/src/api/protocol.test.ts packages/server/src/api/http.test.ts
bun run typecheck
```

Expected: the moved tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the API move**

```bash
git add packages/server/src
git commit -m "refactor(server): organize API boundary"
```

---

### Task 2: Move the Application Layer

**Files:**

- Move: `packages/server/src/app.ts` → `packages/server/src/application/app.ts`
- Move: `packages/server/src/commands.ts` → `packages/server/src/application/commands.ts`
- Move: `packages/server/src/commands.test.ts` → `packages/server/src/application/commands.test.ts`
- Move: `packages/server/src/layout.ts` → `packages/server/src/application/layout.ts`
- Move: `packages/server/src/layout.test.ts` → `packages/server/src/application/layout.test.ts`
- Move: `packages/server/src/snapshot.ts` → `packages/server/src/application/snapshot.ts`
- Move: `packages/server/src/recovery.test.ts` → `packages/server/src/application/recovery.test.ts`
- Modify: `packages/server/src/api/http.test.ts`
- Modify: `packages/server/src/api/http.ts`
- Modify: `packages/server/src/client.ts`
- Modify: `packages/server/src/database.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/lifecycle.ts`

**Interfaces:**

- Consumes: `Command`, `CommandResult`, `ProtocolError`, snapshot types, and byte codecs from `api/protocol.ts`.
- Produces: `createApp`, `WorkCraftApp`, `Health`, `applyCommand`, `DomainEffect`, `readSnapshot`, `CATEGORIES`, and `splitLayout` with unchanged signatures.

- [ ] **Step 1: Run the application characterization tests before moving files**

Run:

```bash
bun test packages/server/src/commands.test.ts packages/server/src/layout.test.ts packages/server/src/recovery.test.ts
```

Expected: all three existing test files pass.

- [ ] **Step 2: Create the capability directory and move application files**

Run:

```bash
mkdir -p packages/server/src/application
git mv packages/server/src/app.ts packages/server/src/application/app.ts
git mv packages/server/src/commands.ts packages/server/src/application/commands.ts
git mv packages/server/src/commands.test.ts packages/server/src/application/commands.test.ts
git mv packages/server/src/layout.ts packages/server/src/application/layout.ts
git mv packages/server/src/layout.test.ts packages/server/src/application/layout.test.ts
git mv packages/server/src/snapshot.ts packages/server/src/application/snapshot.ts
git mv packages/server/src/recovery.test.ts packages/server/src/application/recovery.test.ts
```

- [ ] **Step 3: Update imports within the application directory**

Use these final relative imports in `application/app.ts`:

```ts
import { applyCommand } from "./commands.ts";
import { TerminalHistory } from "../history.ts";
import { decodeBytes, encodeBytes, parseCommand } from "../api/protocol.ts";
import { RuntimeRegistry } from "../runtime.ts";
import { readSnapshot } from "./snapshot.ts";
```

Keep the existing type import block in `app.ts`, changing only its source to `../api/protocol.ts`.

Use these imports in the remaining production modules:

```ts
// application/commands.ts
import { splitLayout } from "./layout.ts";
import { ProtocolError } from "../api/protocol.ts";
import type { Command, CommandResult, LayoutNode } from "../api/protocol.ts";

// application/layout.ts
import type { LayoutNode } from "../api/protocol.ts";

// application/snapshot.ts
import type { TerminalHistory } from "../history.ts";
import { encodeBytes } from "../api/protocol.ts";
```

Keep the existing protocol type import block in `snapshot.ts`, changing only its source to `../api/protocol.ts`.

- [ ] **Step 4: Update imports in moved application tests**

Use local imports for application modules and parent imports for dependencies:

```ts
// application/commands.test.ts
import { createApp, type WorkCraftApp } from "./app.ts";
import { applyCommand } from "./commands.ts";
import { openDatabase } from "../database.ts";
import { ProtocolError } from "../api/protocol.ts";
import { readSnapshot } from "./snapshot.ts";

// application/layout.test.ts
import { splitLayout } from "./layout.ts";

// application/recovery.test.ts
import { createApp, type WorkCraftApp } from "./app.ts";
import { applyCommand } from "./commands.ts";
import { openDatabase } from "../database.ts";
import { decodeBytes, type Snapshot } from "../api/protocol.ts";
```

- [ ] **Step 5: Redirect application consumers**

Apply these exact path changes:

```ts
// api/http.ts
import type { WorkCraftApp } from "../application/app.ts";

// api/http.test.ts
import { createApp } from "../application/app.ts";

// client.ts
import type { Health } from "./application/app.ts";

// database.test.ts
import { CATEGORIES, readSnapshot } from "./application/snapshot.ts";

// lifecycle.ts
import { createApp, type WorkCraftApp } from "./application/app.ts";
```

Update `packages/server/src/index.ts`:

```ts
export * from "./application/app.ts";
export * from "./application/commands.ts";
export * from "./application/snapshot.ts";
```

`layout.ts` remains internal and is not added to the package barrel.

- [ ] **Step 6: Verify the application move**

Run:

```bash
bun test packages/server/src/application/commands.test.ts packages/server/src/application/layout.test.ts packages/server/src/application/recovery.test.ts packages/server/src/api/http.test.ts packages/server/src/database.test.ts
bun run typecheck
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit the application move**

```bash
git add packages/server/src
git commit -m "refactor(server): organize application layer"
```

---

### Task 3: Move Terminal Capabilities

**Files:**

- Move: `packages/server/src/history.ts` → `packages/server/src/terminal/history.ts`
- Move: `packages/server/src/history.test.ts` → `packages/server/src/terminal/history.test.ts`
- Move: `packages/server/src/restore.ts` → `packages/server/src/terminal/restore.ts`
- Move: `packages/server/src/runtime.ts` → `packages/server/src/terminal/runtime.ts`
- Move: `packages/server/src/runtime.test.ts` → `packages/server/src/terminal/runtime.test.ts`
- Modify: `packages/server/src/api/http.test.ts`
- Modify: `packages/server/src/application/app.ts`
- Modify: `packages/server/src/application/snapshot.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**

- Consumes: Pane and snapshot contract types from `api/protocol.ts`; SQLite's `Database` type.
- Produces: `TerminalHistory`, `resolveShellSpawn`, `RuntimePane`, `RuntimeRegistry`, and `RuntimeCallbacks` with unchanged signatures.

- [ ] **Step 1: Run terminal characterization tests before moving files**

Run:

```bash
bun test packages/server/src/history.test.ts packages/server/src/runtime.test.ts
```

Expected: both existing test files pass.

- [ ] **Step 2: Create the capability directory and move terminal files**

Run:

```bash
mkdir -p packages/server/src/terminal
git mv packages/server/src/history.ts packages/server/src/terminal/history.ts
git mv packages/server/src/history.test.ts packages/server/src/terminal/history.test.ts
git mv packages/server/src/restore.ts packages/server/src/terminal/restore.ts
git mv packages/server/src/runtime.ts packages/server/src/terminal/runtime.ts
git mv packages/server/src/runtime.test.ts packages/server/src/terminal/runtime.test.ts
```

- [ ] **Step 3: Update imports inside the terminal capability**

Use:

```ts
// terminal/restore.ts
import type { Snapshot } from "../api/protocol.ts";

// terminal/runtime.ts
import type { PaneStatus } from "../api/protocol.ts";
import { resolveShellSpawn, type RuntimePane } from "./restore.ts";
```

Use these imports in `terminal/runtime.test.ts`:

```ts
import { openDatabase } from "../database.ts";
import { TerminalHistory } from "./history.ts";
import type { PaneStatus } from "../api/protocol.ts";
import { resolveShellSpawn, type RuntimePane } from "./restore.ts";
import { RuntimeRegistry, type RuntimeCallbacks } from "./runtime.ts";
```

Use these imports in `terminal/history.test.ts`:

```ts
import { openDatabase } from "../database.ts";
import { TerminalHistory } from "./history.ts";
```

- [ ] **Step 4: Redirect terminal consumers**

Update application imports:

```ts
// application/app.ts
import { TerminalHistory } from "../terminal/history.ts";
import { RuntimeRegistry } from "../terminal/runtime.ts";

// application/snapshot.ts
import type { TerminalHistory } from "../terminal/history.ts";

// api/http.test.ts
import { TerminalHistory } from "../terminal/history.ts";
```

Update `packages/server/src/index.ts`:

```ts
export * from "./terminal/history.ts";
export * from "./terminal/restore.ts";
export * from "./terminal/runtime.ts";
```

- [ ] **Step 5: Verify the terminal move**

Run:

```bash
bun test packages/server/src/terminal/history.test.ts packages/server/src/terminal/runtime.test.ts packages/server/src/application/recovery.test.ts packages/server/src/api/http.test.ts
bun run typecheck
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the terminal move**

```bash
git add packages/server/src
git commit -m "refactor(server): organize terminal capabilities"
```

---

### Task 4: Move Persistence

**Files:**

- Move: `packages/server/src/database.ts` → `packages/server/src/persistence/database.ts`
- Move: `packages/server/src/database.test.ts` → `packages/server/src/persistence/database.test.ts`
- Modify: `packages/server/src/api/http.test.ts`
- Modify: `packages/server/src/application/commands.test.ts`
- Modify: `packages/server/src/application/recovery.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/lifecycle.ts`
- Modify: `packages/server/src/terminal/history.test.ts`
- Modify: `packages/server/src/terminal/runtime.test.ts`

**Interfaces:**

- Consumes: Bun's SQLite implementation.
- Produces: `openDatabase(path: string): Database` with unchanged schema and durability behavior.

- [ ] **Step 1: Run persistence characterization tests before moving files**

Run:

```bash
bun test packages/server/src/database.test.ts
```

Expected: the existing database and snapshot projection tests pass.

- [ ] **Step 2: Create the capability directory and move persistence files**

Run:

```bash
mkdir -p packages/server/src/persistence
git mv packages/server/src/database.ts packages/server/src/persistence/database.ts
git mv packages/server/src/database.test.ts packages/server/src/persistence/database.test.ts
```

- [ ] **Step 3: Update the moved persistence test**

Use:

```ts
import { openDatabase } from "./database.ts";
import { CATEGORIES, readSnapshot } from "../application/snapshot.ts";
```

Do not change the migration SQL, PRAGMAs, seed data, or snapshot assertions.

- [ ] **Step 4: Redirect persistence consumers**

Use `../persistence/database.ts` in:

```text
packages/server/src/api/http.test.ts
packages/server/src/application/commands.test.ts
packages/server/src/application/recovery.test.ts
packages/server/src/terminal/history.test.ts
packages/server/src/terminal/runtime.test.ts
```

Use `./persistence/database.ts` in `packages/server/src/lifecycle.ts`.

Update `packages/server/src/index.ts`:

```ts
export * from "./persistence/database.ts";
```

- [ ] **Step 5: Verify the persistence move**

Run:

```bash
bun test packages/server/src/persistence/database.test.ts packages/server/src/application/commands.test.ts packages/server/src/application/recovery.test.ts packages/server/src/terminal/history.test.ts packages/server/src/terminal/runtime.test.ts packages/server/src/api/http.test.ts
bun run typecheck
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the persistence move**

```bash
git add packages/server/src
git commit -m "refactor(server): organize persistence"
```

---

### Task 5: Move Daemon Ownership and Complete Verification

**Files:**

- Move: `packages/server/src/lifecycle.ts` → `packages/server/src/daemon/lifecycle.ts`
- Move: `packages/server/src/lifecycle.test.ts` → `packages/server/src/daemon/lifecycle.test.ts`
- Move: `packages/server/src/paths.ts` → `packages/server/src/daemon/paths.ts`
- Move: `packages/server/src/paths.test.ts` → `packages/server/src/daemon/paths.test.ts`
- Modify: `packages/server/src/acceptance.test.ts`
- Modify: `packages/server/src/client.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/main.ts`

**Interfaces:**

- Consumes: `createApp`, `openDatabase`, `startHttpServer`, and the root daemon entrypoint.
- Produces: `runDaemon(paths: WorkCraftPaths): Promise<void>`, `resolvePaths(env?: NodeJS.ProcessEnv): WorkCraftPaths`, and unchanged root entrypoints.

- [ ] **Step 1: Run daemon characterization tests before moving files**

Run:

```bash
bun test packages/server/src/paths.test.ts packages/server/src/lifecycle.test.ts packages/server/src/acceptance.test.ts
```

Expected: path, lifecycle, and process-level acceptance tests pass.

- [ ] **Step 2: Create the capability directory and move daemon files**

Run:

```bash
mkdir -p packages/server/src/daemon
git mv packages/server/src/lifecycle.ts packages/server/src/daemon/lifecycle.ts
git mv packages/server/src/lifecycle.test.ts packages/server/src/daemon/lifecycle.test.ts
git mv packages/server/src/paths.ts packages/server/src/daemon/paths.ts
git mv packages/server/src/paths.test.ts packages/server/src/daemon/paths.test.ts
```

- [ ] **Step 3: Update daemon implementation imports**

Use:

```ts
// daemon/lifecycle.ts
import { createApp, type WorkCraftApp } from "../application/app.ts";
import { openDatabase } from "../persistence/database.ts";
import { startHttpServer } from "../api/http.ts";
import type { WorkCraftPaths } from "./paths.ts";

// main.ts
import { runDaemon } from "./daemon/lifecycle.ts";
import { resolvePaths } from "./daemon/paths.ts";

// client.ts
import { resolvePaths } from "./daemon/paths.ts";
```

Keep `new URL("./main.ts", import.meta.url)` in `client.ts` unchanged.

- [ ] **Step 4: Update lifecycle test imports and root path assumptions**

Use these imports in `daemon/lifecycle.test.ts`:

```ts
import { createClient } from "../client.ts";
import { openDatabase } from "../persistence/database.ts";
import { runDaemon } from "./lifecycle.ts";
import { resolvePaths } from "./paths.ts";
```

Replace its root constants with:

```ts
const ROOT = join(import.meta.dir, "../../../..");
const MAIN_PATH = join(import.meta.dir, "../main.ts");
```

Replace every `cwd: join(import.meta.dir, "../../..")` in that test with:

```ts
cwd: ROOT,
```

This preserves the existing repository-root working directory after moving the test one directory deeper.

- [ ] **Step 5: Redirect remaining daemon consumers**

Update `acceptance.test.ts`:

```ts
import { resolvePaths } from "./daemon/paths.ts";
```

Update `packages/server/src/index.ts`:

```ts
export * from "./daemon/paths.ts";
```

Do not export `daemon/lifecycle.ts`; `runDaemon` was not part of the previous package barrel.

- [ ] **Step 6: Verify daemon behavior and the final source tree**

Run:

```bash
bun test packages/server/src/daemon/paths.test.ts packages/server/src/daemon/lifecycle.test.ts packages/server/src/acceptance.test.ts
bun run check
```

Expected: selected daemon tests pass, then lint, formatting, type checking, all tests, production build, and build smoke test all pass.

Confirm no old implementation files remain:

```bash
test ! -e packages/server/src/app.ts
test ! -e packages/server/src/protocol.ts
test ! -e packages/server/src/runtime.ts
test ! -e packages/server/src/database.ts
test ! -e packages/server/src/lifecycle.ts
```

Expected: all commands exit successfully with no output.

- [ ] **Step 7: Inspect and commit the completed organization**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Verify that changes are limited to file moves, relative imports, and the lifecycle test's adjusted root path. Then commit:

```bash
git add packages/server/src
git commit -m "refactor(server): organize daemon ownership"
```
