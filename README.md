# Work Craft

A local-first terminal work organizer with persistent execution surfaces. Work Craft provides durable sessions, workspaces, six fixed work categories, projects, items, tabs, split layouts, and terminal panes.

One local Bun daemon owns the SQLite database, terminal runtimes, and bounded terminal history. The React/OpenTUI interface and Unix-style CLI are disposable clients connected through an owner-only Unix socket.

## Requirements

- [Bun](https://bun.sh/) 1.4 or newer
- macOS or Linux

## Get Started

```sh
bun install
bun run tui
bun run cli -- list
bun run cli -- status --json
bun run cli -- stop
```

The TUI creates and navigates sessions, workspaces, projects, items, tabs, and terminal splits. The CLI provides non-interactive `list`, `open`, `status`, and `stop` commands with plain-text or JSON output.

## Local State

The default state directory is `$XDG_STATE_HOME/work-craft` when `XDG_STATE_HOME` is set, otherwise `~/.local/state/work-craft`. It contains:

- `work-craft.sqlite` - durable hierarchy, layouts, pane status, restore policy, and bounded terminal history
- `work-craft.sock` - owner-only local Unix socket
- `daemon.lock` - single-daemon ownership lock

Set `WORK_CRAFT_HOME` to use a different state directory, including an isolated directory for development or testing:

```sh
WORK_CRAFT_HOME=/tmp/work-craft bun run tui
```

Clients start the daemon on demand when it is not running. Closing the TUI or finishing a CLI command does not stop it or its terminal panes; use `bun run cli -- stop` for a clean shutdown.

After a daemon or machine restart, Work Craft reloads SQLite state, retains bounded terminal output, inserts a visible restart separator, and starts one fresh shell for each eligible pane. This first slice restores shells only; it does not checkpoint arbitrary process memory.

## First Slice Boundaries

Category-specific screens, `gh`/`az` views, Neovim/OpenCode metadata integration, remote access, and agent automation are outside this slice.

## Development

```sh
bun run check
```

To run checks individually, use `bun run lint`, `bun run format:check`, `bun run typecheck`, or `bun run test`.

## License

[MIT](LICENSE)
