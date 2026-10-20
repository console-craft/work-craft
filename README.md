# Work Craft

A local-first terminal work organizer with persistent terminals, tabs, and splits.

- Organize reusable workspaces into named sessions and six categories: Inbox, Today, Design, Coding (Implementation), Collaboration, and Operations.
- Open root items or their one-level children into their own terminal workspaces.
- Register existing repositories and browse their linked Git worktrees without changing branches or creating checkouts.
- Detach and reconnect without stopping running terminals.

One local Bun daemon owns SQLite state, terminal processes, and bounded terminal history. The React/OpenTUI interface and non-interactive CLI are disposable clients connected through an owner-only Unix socket. Work Craft is local-only on macOS and Linux.

## Install

Prebuilt releases support Apple Silicon macOS (`darwin-arm64`) and x86-64 glibc Linux (`linux-x64`). Download the matching archive from [GitHub Releases](https://github.com/console-craft/work-craft/releases), then install the executable somewhere on your `PATH`.

For example, replace `X.Y.Z` below with the downloaded release version:

```sh
tar -xzf work-craft-vX.Y.Z-darwin-arm64.tar.gz
mkdir -p ~/.local/bin
install -m 755 work-craft ~/.local/bin/work-craft
```

Intel macOS, Linux ARM64, and musl Linux do not currently have supported prebuilt releases.

## Everyday Use

Run `work-craft` to open the TUI. The daemon starts on demand. On an empty installation, press `Ctrl+Space`, then `n` in the session chooser to create a session. Focus the workspace bar and press `n` to create a workspace, then choose a category.

The status bar shows actions available for the focused region. **Leader** means `Ctrl+Space` followed by another key. Hyper shortcuts require a terminal/key mapping that sends Hyper or the supported Ctrl+Alt/Option+Super combination.

| Keys                    | Action                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `Ctrl+h/j/k/l`          | Move focus left/down/up/right between shell regions and panes                                |
| `n`                     | Create in the focused session/workspace/results context; Coding results register a directory |
| `Hyper+s`               | Open the session chooser                                                                     |
| `Hyper+h/l`             | Previous/next category                                                                       |
| `Hyper+k/j`             | Open the previous/next navigator item                                                        |
| `leader+b`              | Toggle the navigator                                                                         |
| `Hyper+[` / `Hyper+]`   | Previous/next tab                                                                            |
| `Hyper+n`               | Create a terminal tab                                                                        |
| `leader+v` / `leader+s` | Split side-by-side / top-bottom                                                              |
| `leader+r`              | Explicitly restart the selected stopped pane                                                 |
| `Hyper+r` / `Hyper+q`   | Reconnect / quit the client                                                                  |

Within navigator results, use arrows or `j/k` to browse and Enter or a primary-button release to open an item. `Tab`/`Shift+Tab` moves between the filter and results; `Ctrl+n` in the filter enters the first match, while Enter in the filter does not open an item. Use `h`/Left, `l`/Right, or Space to collapse/expand roots when not filtering. Filters and expansion stay local to each workspace/category without changing the active workbench.

The tab strip changes the displayed tab while browsing; Enter/Space or a primary-button release requests entry into its terminal. Switching tabs from a running terminal enters the destination's remembered running pane, or its first usable running pane. New input/navigation cancels a pending entry.

The navigator docks at 120+ columns and becomes a dismissible drawer at 80–119 columns. Below 80 columns, a resize message blocks interaction. Application overlays always leave the one-row status bar visible.

### Coding And Terminal Recovery

In Coding results, press `n` to register an existing directory. Git repositories appear with the primary non-bare checkout as the parent and linked worktrees as children, even if a linked path is registered first. Discovery runs immediately and every five seconds. Plain directories remain exact-path targets. Work Craft never creates/deletes checkouts or changes branches.

Successful TUI registration opens the requested checkout's terminal, including duplicate registrations. Reopening preserves its surface, active tab, shell, and history; new tabs start at the item's path. Missing checkouts remain marked unavailable. Press `a` on an unavailable Coding result to request archival; terminals keep running, and archiving a root hides its children without deleting them. Restore is explicit through CLI/API.

Splits inherit the owned shell's live working directory after `cd`, not a foreground child's private cwd. Each successful split equalizes pane shares in the affected tab while preserving existing processes and output. CLI `--cwd` overrides discovery and resolves relative to the CLI's directory; invalid/unavailable paths fail without adding a pane. macOS uses bounded `/usr/sbin/lsof` discovery; Linux uses `/proc/<shell-pid>/cwd`.

Stopped panes retain output/history and never restart from typing or pasting. Use `leader+r` for explicit restart, or the **Reactivate** action on an exited pane. Terminal input requires a 20-column by five-row viewport; Reactivate requires a 20-column by four-row pane. Splitting, creating a tab, and restarting enter only their exact ready destination.

Operational failures appear as source-labelled, eight-second status messages; field validation stays beside its field. Failed sources retain compact indicators, and child-program output stays in its terminal.

### CLI Examples

The same executable provides plain-text output by default and JSON with `--json`. Replace uppercase ID placeholders with IDs returned by earlier commands or `snapshot`:

```sh
work-craft session create --name Main --json
work-craft workspace create --session SESSION_ID --name Work --json
work-craft directory register --workspace WORKSPACE_ID --path ~/code/repository --json
work-craft surface ensure --item ITEM_ID --json
work-craft pane split PANE_ID --direction vertical --json
work-craft pane split PANE_ID --direction horizontal --cwd ./checkout
work-craft item create --workspace WORKSPACE_ID --category design --title Notes
work-craft item archive ITEM_ID
work-craft item restore ITEM_ID --json
work-craft snapshot --json
work-craft daemon status --json
```

CLI/API directory registration is metadata-only: it never opens a surface or focuses a client. Its JSON result includes `id`/`itemId` for the requested checkout and `rootItemId` for its parent. Open a surface explicitly with `surface ensure`.

Sessions are profiles over reusable workspaces. Switching or deleting a session does not stop its workspaces' terminals; deleting a session does not delete those workspaces. The CLI also supports session updates, workspace membership, tab creation/selection, and pane restart. See the [command syntax](packages/cli/src/args.ts) for the complete CLI surface; old project commands are not aliases.

## Local State And Recovery

The default state directory is `$XDG_STATE_HOME/work-craft` when `XDG_STATE_HOME` is set, otherwise `~/.local/state/work-craft`. It contains:

- `work-craft.sqlite` — durable hierarchy, layouts, pane status, restore policies, and bounded terminal history
- `work-craft.sock` — owner-only local Unix socket
- `daemon.lock` — single-daemon ownership lock

Set `WORK_CRAFT_HOME` to use another state directory. Use a separate home for development/experiments, and use the same value for every client intended to share that daemon:

```sh
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" work-craft
```

Closing a client does not stop the daemon or its terminals. For a clean shutdown that preserves state:

```sh
work-craft daemon stop
```

After a daemon or machine restart, Work Craft reloads SQLite state, retains bounded output, inserts a restart separator, and starts one fresh shell per eligible pane. It restores shells, not arbitrary Unix process memory.

### Compatibility And Destructive Reset

Schema 4 rejects incompatible development databases, including schema 3, without migrating or deleting them. Old independent-worktree records/surfaces are not merged. Prefer a fresh `WORK_CRAFT_HOME` for experiments; startup never silently resets data.

**`daemon destroy --force` stops all managed runtimes and deletes persisted Work Craft state for the selected home.** Only use it after deciding to discard those records:

1. Close reconnecting TUI/watch clients.
2. Resolve and confirm the concrete state directory, its `work-craft.sqlite` path, and which runtimes will be stopped.
3. Use a compatible executable with `WORK_CRAFT_HOME` explicitly set to that confirmed directory, then run `work-craft daemon destroy --force`.
4. Restart all clients coherently on the new version.

Destroy stops/reaps managed terminals before removing the database/sidecars; it never deletes registered directories, source work, or Git metadata. Do not delete the entire state directory or manually remove a live daemon's lock/socket.

### Current Limitations

- Specialized non-Coding category screens, `gh`/`az` views, Neovim/OpenCode restore metadata, remote access, agent automation, and shared session navigation are not implemented.
- Repository identity is path-based: replacing a repository at the same paths is not detected as a new incarnation. Moved worktrees can leave an unavailable old entry. Registration/discovery never retargets, merges, or restarts existing terminals.
- Bare repositories are plain-directory targets. Linked worktrees with only a bare backing repository, and separate-git-dir layouts without a registered primary checkout, are rejected rather than guessed.
- Demo theme cycling is not an application theme-switching feature. Automated checks do not certify physical-terminal visual/focus behavior or long-running listener stability; Linux live-cwd behavior was not manually verified on the macOS development host.

## Development

Use [Bun](https://bun.sh/); `package.json` pins the toolchain version. From the repository root:

```sh
bun install
bun run dev
```

`dev` restarts the TUI when source files change; `bun run tui` runs it once. Run CLI commands from source with `bun run cli -- snapshot` or `bun run cli -- daemon status --json`. To keep development state separate:

```sh
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-dev" bun run dev
```

### UI Demos

Run the standalone controls or composite-component showcase:

```sh
CONTROLS_DEMO=true bun run tui
COMPONENTS_DEMO=true bun run tui
```

Use the same environment variables with `bun run dev` for watch mode. Both demos support `Ctrl+t` to cycle themes, `Ctrl+r` to cycle content widths, `Tab`/`Shift+Tab` to traverse controls, and `Ctrl+c` to exit. Click the page background to focus scrolling; focused controls retain their editing/navigation keys. Nested scroll areas keep wheel scrolling local.

The composite showcase includes cards, badges, alerts, spinners, progress, disclosure, tabs, fields, empty states, dialogs, menus, commands, notifications, tables, lists, and horizontal scrolling. Demo sections live in `packages/tui/src/demos/component-demos/`.

### Checks And Builds

Run the full gate before completing changes:

```sh
bun run check
```

It runs lint, formatting checks, typechecking, all tests, a current-host standalone build, and compiled CLI/TUI/daemon smoke coverage. Individual commands are `bun run lint`, `bun run format:check`, `bun run typecheck`, and `bun run test`.

Build without installing, or build and install to `~/.local/bin`:

```sh
bun run build
bun run build:install
```

Set `WORK_CRAFT_BIN_DIR` to install elsewhere:

```sh
WORK_CRAFT_BIN_DIR="$HOME/bin" bun run build:install
```

The executable is written to `dist/work-craft`; `build` does not copy it outside the repository. The installer creates the destination directory and warns if it is not on `PATH`, without modifying shell configuration.

### Repository Map

```text
work-craft/
├── src/main.ts                  # Dispatches to TUI, CLI, or internal daemon
├── packages/
│   ├── server/src/               # Durable state and runtime authority
│   │   ├── client.ts             # Client-safe API and protocol exports
│   │   ├── api/                  # Local HTTP/WebSocket interface
│   │   ├── application/          # Commands, queries, and domain operations
│   │   ├── daemon/               # Daemon lifecycle and ownership
│   │   ├── persistence/          # SQLite storage and schema handling
│   │   └── terminal/             # PTYs, processes, history, and cwd discovery
│   ├── cli/src/                  # Argument parsing and text/JSON commands
│   └── tui/src/
│       ├── main.tsx              # Renderer bootstrap and demo selection
│       ├── app.tsx               # Application/provider composition
│       ├── client/               # Synchronized store and terminal buffers
│       ├── input/                # Keyboard routing and spatial focus rules
│       ├── shell/                # Composition, commands, focus, and entry
│       ├── navigation/           # Workspace/category item navigation
│       ├── workbench/            # Tabs, split geometry, and terminal leaves
│       ├── ui/                   # Reusable UI, interaction, and theming
│       ├── demos/                # Standalone UI showcases
│       └── tests/                # Package-wide acceptance and shared support
├── scripts/                      # Installation and compiled smoke checks
├── docs/tui-source-map.md        # Detailed current TUI ownership guide
├── docs/superpowers/specs/       # Dated designs and decision history
├── AGENTS.md                     # Contributor-agent rules and constraints
└── package.json                  # Workspace scripts and tool versions
```

TUI capability tests live in their owner's `tests/` directory; `tui/src/tests/` is for package-wide acceptance and genuinely shared support. See the [TUI source map](docs/tui-source-map.md) for current file ownership, test commands, import boundaries, and native terminal timing invariants.

## Further Reading

- [Agent guidelines](AGENTS.md) — contribution rules and architectural guardrails
- [Architecture design](docs/superpowers/specs/2026-09-16-work-craft-architecture-design.md) — product model, ownership, persistence, and recovery
- [TUI source map](docs/tui-source-map.md) — current implementation guide
- [Component adoption inventory](docs/superpowers/specs/2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries) — component owners and deliberate native boundaries
- [Changelog](CHANGELOG.md) — released changes

Dated specifications retain design decisions and historical checkpoints; they are not a substitute for current usage instructions or the current source map.

## License

[MIT](LICENSE)
