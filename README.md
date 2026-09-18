# Work Craft

A local-first terminal work organizer with persistent execution surfaces. Sessions are named profiles over reusable workspaces, which contain six fixed work categories, projects, items, tabs, split layouts, and terminal panes.

One local Bun daemon owns the SQLite database, terminal runtimes, and bounded terminal history. The React/OpenTUI interface and Unix-style CLI are disposable clients connected through an owner-only Unix socket.

## Install

Prebuilt releases support Apple Silicon macOS and x86-64 glibc Linux. Download the archive for your platform from the GitHub release, then install the executable somewhere on your `PATH`:

```sh
tar -xzf work-craft-vX.Y.Z-darwin-arm64.tar.gz
mkdir -p ~/.local/bin
install -m 755 work-craft ~/.local/bin/work-craft
```

Run `work-craft` to open the TUI. The same executable provides the non-interactive CLI:

```sh
work-craft snapshot
work-craft session create --name Main --json
work-craft session update <session-id> --name Focused --position 0
work-craft session add-workspace <session-id> --workspace <workspace-id>
work-craft session remove-workspace <session-id> --workspace <workspace-id>
work-craft session delete <session-id>
work-craft surface ensure --item <item-id>
work-craft daemon status --json
work-craft daemon stop
work-craft daemon destroy --force
```

Intel macOS, Linux ARM64, and musl Linux do not currently have supported prebuilt releases.

## Develop

Development requires [Bun](https://bun.sh/) 1.4 or newer on macOS or Linux.

Install dependencies and run from source:

```sh
bun install
bun run tui
bun run cli -- snapshot
bun run cli -- session create --name Main --json
bun run cli -- surface ensure --item <item-id>
bun run cli -- daemon status --json
bun run cli -- daemon stop
bun run cli -- daemon destroy --force
```

Build a standalone executable for the current machine with:

```sh
bun run build
```

The executable is written to `dist/work-craft`. Building does not install or copy it outside the repository.

Build and install it to `~/.local/bin` with:

```sh
bun run build:install
```

Set `WORK_CRAFT_BIN_DIR` to install elsewhere:

```sh
WORK_CRAFT_BIN_DIR="$HOME/bin" bun run build:install
```

The installer creates the destination directory and warns if it is not on `PATH`. It does not modify shell configuration.

The TUI creates and navigates sessions, workspaces, projects, items, tabs, and terminal splits. It shows one session at a time; switching sessions does not stop terminals hidden by the new selection. Deleting a session does not delete its reusable workspaces or stop their terminal panes. The CLI exposes snapshot, hierarchy creation, surface/tab/pane operations, and daemon lifecycle operations with plain-text or JSON output.

## Local State

The default state directory is `$XDG_STATE_HOME/work-craft` when `XDG_STATE_HOME` is set, otherwise `~/.local/state/work-craft`. It contains:

- `work-craft.sqlite` - durable hierarchy, layouts, pane status, restore policy, and bounded terminal history
- `work-craft.sock` - owner-only local Unix socket
- `daemon.lock` - single-daemon ownership lock

Set `WORK_CRAFT_HOME` to use a different state directory, including an isolated directory for development or testing:

```sh
WORK_CRAFT_HOME=/tmp/work-craft work-craft
```

Clients start the daemon on demand when it is not running. Closing the TUI or finishing a CLI command does not stop it or its terminal panes; use `work-craft daemon stop` for a clean shutdown that preserves state. Use `work-craft daemon destroy --force` to stop all managed runtimes, delete persisted Work Craft state, and stop the daemon.

After a daemon or machine restart, Work Craft reloads SQLite state, retains bounded terminal output, inserts a visible restart separator, and starts one fresh shell for each eligible pane. This first slice restores shells only; it does not checkpoint arbitrary process memory.

## First Slice Boundaries

Category-specific screens, `gh`/`az` views, Neovim/OpenCode metadata integration, remote access, and agent automation are outside this slice.

Run the complete correctness gate with `bun run check`. It includes linting, formatting, typechecking, tests, a current-host standalone build, and a packaged daemon smoke test.

To run checks individually, use `bun run lint`, `bun run format:check`, `bun run typecheck`, or `bun run test`.

## License

[MIT](LICENSE)
