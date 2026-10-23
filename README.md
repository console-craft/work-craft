# Work Craft

A local-first terminal work organizer with persistent terminals, tabs, and splits.

- Organize reusable workspaces into named sessions and six categories: Inbox, Today, Design, Coding (Implementation), Collaboration, and Operations.
- Open root items or their one-level children into their own terminal workspaces.
- Register existing repositories and browse their linked Git worktrees without changing branches or creating checkouts.
- Detach and reconnect without stopping running terminals.
- Share a session across clients to mirror navigation and one running editor.

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

Browsing the tab strip changes only your local candidate. Enter/Space or a primary-button release activates that tab for the session and requests terminal entry. Explicit previous/next-tab shortcuts also change shared selection. Entry uses the session's remembered pane; it never silently substitutes a running sibling for a stopped or locally clipped selection. New input/navigation cancels a pending entry.

The navigator docks at 120+ columns and becomes a dismissible drawer at 80–119 columns. Below 80 columns, a resize message blocks interaction. Application overlays always leave the one-row status bar visible.

### Shared Sessions

Clients attached to the same session share workspace, category, item, tab and pane selection. They see the same running terminal application, including Neovim edits and logical cursor movement—not separately launched editors. Each client keeps its own attachment, keyboard focus, browsing cursors, filters, expansion, drawer and drafts. Remote navigation follows focus already inside an unobscured workbench, but does not steal focus from editing or close an observer's overlay.

Different sessions retain independent selections and tab/pane memories even when they share a workspace and its running terminals. One eligible, latest-active viewer determines each tab's terminal dimensions across all sessions. Attachment and user input count as activity; idle resizing, output and programmatic focus do not. An owner's resize applies immediately; a non-owner's resize changes only its candidate viewport. Covered or unusable viewers withdraw; with no eligible viewer, the daemon retains the last usable grid.

Every viewer parses output at those canonical dimensions. Smaller local panes clip and follow the shared terminal cursor; larger panes show unused background. This changes neither the program's identity nor another client's local shell layout.

### Coding And Terminal Recovery

In Coding results, press `n` to register an existing directory. Git repositories appear with the primary non-bare checkout as the parent and linked worktrees as children, even if a linked path is registered first. Discovery runs immediately and every five seconds. Plain directories remain exact-path targets. Work Craft never creates/deletes checkouts or changes branches.

Successful TUI registration opens the requested checkout's terminal, including duplicate registrations. Reopening preserves its surface, active tab, shell, and history; new tabs start at the item's path. Missing checkouts remain marked unavailable. Press `a` on an unavailable Coding result to request archival; terminals keep running, and archiving a root hides its children without deleting them. Restore is explicit through CLI/API.

Splits inherit the owned shell's live working directory after `cd`, not a foreground child's private cwd. Each successful split equalizes pane shares in the affected tab while preserving existing processes and output. CLI `--cwd` overrides discovery and resolves relative to the CLI's directory; invalid/unavailable paths fail without adding a pane. macOS uses bounded `/usr/sbin/lsof` discovery; Linux uses `/proc/<shell-pid>/cwd`.

Stopped panes keep bounded output scrollable with the mouse wheel; browsing, typing and pasting never restart a shell. Use `leader+r` for explicit restart, or **Reactivate** on an exited pane. A fresh shell starts below `[work-craft: shell restarted manually]`, with older output retained as read-only scrollback. Client Reconnect neither starts a shell nor adds a divider. Terminal input and wheel browsing require a 20-column by five-row viewport; Reactivate requires a 20-column by four-row pane. Splitting, creating a tab, and restarting enter only their exact ready destination.

Operational failures appear as source-labelled, eight-second status messages; field validation stays beside its field. Failed sources retain compact indicators, and child-program output stays in its terminal.

### CLI Examples

The same executable provides plain-text output by default and JSON with `--json`. Replace uppercase ID placeholders with IDs returned by earlier commands or `snapshot`:

```sh
work-craft session create --name Main --json
work-craft workspace create --session SESSION_ID --name Work --json
work-craft directory register --workspace WORKSPACE_ID --path ~/code/repository --json
work-craft surface ensure --item ITEM_ID --json
work-craft session open-item SESSION_ID --item ITEM_ID --json
work-craft session select SESSION_ID --workspace WORKSPACE_ID
work-craft session select SESSION_ID --category implementation
work-craft session select SESSION_ID --item ITEM_ID
work-craft session select SESSION_ID --tab TAB_ID
work-craft session select SESSION_ID --pane PANE_ID --json
work-craft session step SESSION_ID --level tab --direction next
work-craft pane split PANE_ID --direction vertical --json
work-craft pane split PANE_ID --direction horizontal --cwd ./checkout
work-craft item create --workspace WORKSPACE_ID --category design --title Notes
work-craft item archive ITEM_ID
work-craft item restore ITEM_ID --json
work-craft snapshot --json
work-craft daemon status --json
```

CLI/API directory registration is metadata-only: it never opens a surface or focuses a client. Its JSON result includes `id`/`itemId` for the requested checkout and `rootItemId` for its parent. `surface ensure` opens/reuses a surface without choosing a session; `session open-item` atomically opens/reuses it and selects it for that session. Selection alone never starts or restarts a terminal. `session select` requires exactly one target flag; `session step` supports category/item/tab and previous/next. JSON navigation results include the authoritative cursor; text snapshots print each session's selected IDs (`-` for null). Obsolete `surface select-tab` is not an alias.

Sessions are profiles over reusable workspaces. Switching or deleting a session does not stop its workspaces' terminals; deleting a session does not delete those workspaces. The CLI also supports session updates, workspace membership, tab creation/selection, and pane restart. See the [command syntax](packages/cli/src/args.ts) for the complete CLI surface; old project commands are not aliases.

## Local State And Recovery

The default state directory is `$XDG_STATE_HOME/work-craft` when `XDG_STATE_HOME` is set, otherwise `~/.local/state/work-craft`. It contains:

- `work-craft.sqlite` — durable hierarchy, session cursors/memories, layouts, pane status, restore policies, and bounded terminal history with resize markers
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

After a daemon or machine restart, Work Craft reloads SQLite state and restores retained output into ordinary pane scrollback above a restart separator and one fresh shell per eligible pane. Already exited/failed panes stay stopped with history readable on demand. Wheel scrolling stays local to each client. Old output contributes display only: terminal input modes and query replies belong exclusively to the fresh shell. Reconnecting a client does not restart that shell or add another separator. Work Craft restores shells, not arbitrary Unix process memory.

### Compatibility And Destructive Reset

Schema 6 migrates schemas 4 and 5 non-destructively in one transaction, preserving IDs, resources, layouts, policies and output. Schema 4 gains per-session cursors/tab memories; schema 5 gains internal runtime boundaries in the bounded resize timeline. Earlier incompatible development schemas remain rejected without deletion; migration failure rolls back. Stop the old daemon and restart every client on the same version: mixed-version operation is unsupported. Prefer a fresh `WORK_CRAFT_HOME` for experiments; startup never silently resets data.

**`daemon destroy --force` stops all managed runtimes and deletes persisted Work Craft state for the selected home.** Only use it after deciding to discard those records:

1. Close reconnecting TUI/watch clients.
2. Resolve and confirm the concrete state directory, its `work-craft.sqlite` path, and which runtimes will be stopped.
3. Use a compatible executable with `WORK_CRAFT_HOME` explicitly set to that confirmed directory, then run `work-craft daemon destroy --force`.
4. Restart all clients coherently on the new version.

Destroy stops/reaps managed terminals before removing the database/sidecars; it never deletes registered directories, source work, or Git metadata. Do not delete the entire state directory or manually remove a live daemon's lock/socket.

### Current Limitations

- Specialized non-Coding category screens, `gh`/`az` views, Neovim/OpenCode restore metadata, remote access, agent automation and further Stage 3/4 pane operations are not implemented.
- History is bounded to 1 MiB and 1,024 resize/runtime-start markers per pane by default. Exceeding either budget explicitly truncates earlier replay with a reset marker. Legacy bytes without geometry are preserved, but their unknown past dimensions cannot be reconstructed.
- Display reconstruction keeps the native 10,000-line scrollback, 2,097,152-cell drawing budget and 8-MiB transcript ceiling. Unsupported or over-budget capture fails the scoped read/start explicitly while preserving durable bytes; it does not silently drop display or retry. Stopped history is reconstructed lazily with one daemon-wide display cache, so switching stopped panes may rebuild it. Regional-indicator spacing and hyperlink/invisible-wide fidelity remain unsupported limitations.
- The native viewport reports in-band resize mode 2048 as unsupported until its emulator can deliver those reports; applications such as Neovim use ordinary terminal resize signals instead.
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

It runs lint, formatting checks, typechecking, ordinary correctness tests, a current-host standalone build, and compiled CLI/TUI/daemon smoke coverage. Individual commands are `bun run lint`, `bun run format:check`, `bun run typecheck`, and `bun run test`. Native parser continuation checks run by default; manual benchmarks and known-failing fidelity reproducers are separate commands, not skipped tests.

Output benchmarks require a fresh directory for their artifacts. The full run includes repeated PTY/native/application comparisons, fifty panes and a ten-minute soak; it is intentionally outside the normal check:

```sh
PROFILE_DIR="$(mktemp -d)"
WORK_CRAFT_OUTPUT_PROFILE_DIR="$PROFILE_DIR" bun run benchmark:output
```

Use `-t 'output profile comparison'` or `-t 'fifty-pane capacity'` after the benchmark command to select a subset.

Run the three OSC8 hyperlink/hidden-wide-cell reproducers explicitly:

```sh
bun run diagnose:hyperlinks
```

These diagnostics preserve their original assertions and currently fail against stock OpenTUI 0.6.6, exiting nonzero. They document unsupported fidelity, not a passing acceptance guarantee. Neither manual command requires an opt-in skip flag; `.benchmark.ts` and `.diagnostic.ts(x)` files run only when explicitly selected.

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
