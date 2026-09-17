# Work Craft Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, smoke-test, and release Work Craft as one executable with TUI, CLI, and internal daemon modes.

**Architecture:** A root entrypoint dispatches no arguments to the TUI, public arguments to the CLI, and one internal argument to the daemon. The server client detects Bun's compiled filesystem and re-executes the current executable in daemon mode; source mode retains the existing TypeScript daemon command.

**Tech Stack:** Bun 1.4, TypeScript, Bun single-file executables, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-17-work-craft-distribution-design.md`

## Global Constraints

- Preserve the three existing source package responsibilities.
- Add no dependencies, installer, updater, or package-manager integration.
- Official prebuilt targets are only `darwin-arm64` and glibc `linux-x64`.
- Keep `bun run check` as the canonical correctness gate.
- Do not create commits unless the user explicitly requests them.

---

### Task 1: Unified Executable And Packaged Smoke Test

**Files:**

- Create: `src/main.ts`
- Create: `scripts/smoke-build.ts`
- Modify: `packages/server/src/client.ts`

**Interfaces:**

- Produces: `INTERNAL_DAEMON_ARG`, shared by the root dispatcher and daemon spawning logic.
- Produces: `src/main.ts`, the only standalone executable entrypoint.
- Consumes: existing TUI, CLI, and daemon entrypoints through dynamic imports.

- [ ] **Step 1: Write the failing packaged smoke check**

Create `scripts/smoke-build.ts` to copy `dist/work-craft` into a temporary installation directory, run `status --json` with a temporary `WORK_CRAFT_HOME`, assert `running === true`, launch the no-argument TUI in a PTY, run `stop --json`, verify the socket disappears, and clean up with the source API if the assertion path fails. Bound spawned commands so a packaging failure cannot hang the gate indefinitely.

- [ ] **Step 2: Run the smoke check to verify it fails**

Run: `bun scripts/smoke-build.ts`

Expected: FAIL because `dist/work-craft` has not been built from the unified entrypoint.

- [ ] **Step 3: Add the root mode dispatcher**

Create `src/main.ts` with this dispatch:

```ts
import { INTERNAL_DAEMON_ARG } from "../packages/server/src/client.ts";

const [command] = process.argv.slice(2);
if (command === INTERNAL_DAEMON_ARG) {
  await import("../packages/server/src/main.ts");
} else if (command === undefined) {
  await import("../packages/tui/src/main.tsx");
} else {
  await import("../packages/cli/src/main.ts");
}
```

- [ ] **Step 4: Make daemon startup aware of compiled execution**

In `packages/server/src/client.ts`, export an internal daemon argument and choose the spawn command from `Bun.main`:

```ts
export const INTERNAL_DAEMON_ARG = "__daemon";

const command = Bun.main.startsWith("/$bunfs/")
  ? [process.execPath, INTERNAL_DAEMON_ARG]
  : [process.execPath, fileURLToPath(new URL("./main.ts", import.meta.url))];
```

- [ ] **Step 5: Compile and run the packaged smoke check**

Run: `mkdir -p dist && bun build --compile src/main.ts --outfile dist/work-craft`

Run: `bun scripts/smoke-build.ts`

Expected: both commands exit 0; JSON status reports a running daemon, the compiled TUI connects, and stop removes the isolated socket.

### Task 2: Development And Correctness Commands

**Files:**

- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**

- Consumes: `src/main.ts` and `scripts/smoke-build.ts` from Task 1.
- Produces: `bun run build`, `bun run build:smoke`, and a comprehensive `bun run check`.

- [ ] **Step 1: Route root development commands through the unified entrypoint**

Set `tui` to `bun src/main.ts`, set `cli` to `bun src/main.ts`, and set `server` to `bun src/main.ts __daemon`.

- [ ] **Step 2: Add build and smoke scripts to the correctness gate**

Add:

```json
"build": "mkdir -p dist && bun build --compile src/main.ts --outfile dist/work-craft",
"build:smoke": "bun scripts/smoke-build.ts"
```

Append `bun run build && bun run build:smoke` to `check`.

- [ ] **Step 3: Ignore generated output**

Add `dist/` to `.gitignore`.

- [ ] **Step 4: Document development, builds, installation, and supported targets**

Update `README.md` to keep Bun-based development instructions, explain `bun run build`, show `install -m 755 dist/work-craft ~/.local/bin/work-craft`, and identify Apple Silicon macOS and x86-64 glibc Linux as the two official prebuilt targets.

- [ ] **Step 5: Run source and packaged checks**

Run: `bun run check`

Expected: lint, formatting, typecheck, tests, current-host build, and packaged smoke test all pass.

### Task 3: Native Target CI And Releases

**Files:**

- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**

- Consumes: `bun run build`, `bun run build:smoke`, and `bun run check` from Task 2.
- Produces: native macOS ARM64 packaging coverage and two GitHub release archives.

- [ ] **Step 1: Add macOS ARM64 package coverage to pull-request CI**

Keep the full `check` job on `ubuntu-latest`. Add a `package-macos` job on `macos-14` that installs frozen dependencies, runs `bun run build`, and runs `bun run build:smoke`.

- [ ] **Step 2: Add the two-target release workflow**

Trigger on published releases and use this native matrix:

```yaml
include:
  - runner: macos-14
    platform: darwin-arm64
  - runner: ubuntu-latest
    platform: linux-x64
```

Each matrix job runs `bun install --frozen-lockfile`, `bun run check`, archives `dist/work-craft`, generates an adjacent SHA-256 file with `shasum -a 256`, and uploads both files with `gh release upload` using `GITHUB_TOKEN`.

- [ ] **Step 3: Validate workflow syntax and final repository checks**

Run: `bun run format:check`

Run: `bun run check`

Expected: both commands exit 0. Review the YAML to confirm the release matrix contains exactly `darwin-arm64` and `linux-x64`.
