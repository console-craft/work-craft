# Work Craft

A local-first terminal work organizer with persistent execution surfaces. Sessions are named profiles over reusable workspaces, with six fixed categories and unified work items. Root items and their one-level children can each own tabs, splits, and persistent terminals.

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
work-craft pane split <pane-id> --direction vertical --json
work-craft pane split <pane-id> --direction horizontal --cwd ./checkout
work-craft workspace create --session <session-id> --name Work
work-craft directory register --workspace <workspace-id> --path ~/code/repository --json
work-craft item archive <item-id>
work-craft item restore <item-id> --json
work-craft item create --workspace <workspace-id> --category design --title Notes
work-craft daemon status --json
work-craft daemon stop
work-craft daemon destroy --force
```

Intel macOS, Linux ARM64, and musl Linux do not currently have supported prebuilt releases.

## Develop

See the [TUI source map](docs/tui-source-map.md) for ownership, test locations,
dependency boundaries and native terminal timing invariants.

Development requires [Bun](https://bun.sh/) 1.4 or newer on macOS or Linux.

Install dependencies and run from source. `bun run dev` restarts the TUI when source files change, while `bun run tui` runs it once:

```sh
bun install
bun run dev
bun run tui
bun run cli -- snapshot
bun run cli -- session create --name Main --json
bun run cli -- surface ensure --item <item-id>
bun run cli -- daemon status --json
bun run cli -- daemon stop
bun run cli -- daemon destroy --force
```

### TUI Component Demos

Run the standalone controls or composite-component demo from source:

```sh
CONTROLS_DEMO=true bun run tui
COMPONENTS_DEMO=true bun run tui
```

Use the same environment variable with `bun run dev` for watch mode. Both demos
support `Ctrl+t` to cycle themes, `Ctrl+r` to cycle content widths, `Tab`/`Shift+Tab`
to traverse controls, and `Ctrl+c` to exit. Click the page background to focus
page scrolling; focused controls retain their own editing and navigation keys.
Nested ScrollAreas keep wheel scrolling local and highlight the eligible
keyboard and pointer scrolling targets independently.

The composite demo covers Card, Badge, Alert, Spinner, Progress, Collapsible,
Accordion, and Tabs, including tabs with scrollable content inside a card.
Application adoption now includes dialogs/forms, workspace/category controls,
filtered navigation and the workbench; the
[adoption inventory](docs/superpowers/specs/2026-10-13-tui-component-adoption-design.md#adopted-components-and-intentional-native-boundaries)
records component owners and intentional native boundaries. This work sits
between the completed Stage 1 shell/input foundation and upcoming Stage 2
shared session navigation in the
[TUI overhaul roadmap](docs/superpowers/specs/2026-09-18-tui-overhaul-design.md).

### Build

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

The TUI creates and navigates sessions, workspaces, items, tabs, and terminal splits. It shows one session at a time; switching sessions does not stop hidden terminals. Deleting a session does not delete reusable workspaces or stop their panes. The CLI supports plain-text and JSON output; old project commands are not aliases.

### Coding navigation

Register an existing directory with `n` on Coding results (the Implementation category). Within each workspace, a repository's primary non-bare checkout is always the parent and its linked worktrees are children, even when a linked path is registered first. Canonical path aliases and duplicate registrations reuse the requested checkout's item. Git checkouts discover external worktrees immediately and every five seconds; Work Craft never creates/deletes checkouts or changes branches. Plain directories and nested directories without their own checkout marker remain exact-path roots.

Successful TUI registration selects and enters the requested checkout's terminal, including on duplicates. Enter or a primary-button release opens either level at its own path. Reopening keeps the surface, active tab, running shell, and history; new tabs start at the owning item's path. Generic item creation also enters its terminal; session/workspace creation keeps its drill-down behavior. Coding has no manually created children or `leader+n` escape hatch.

CLI/API registration is metadata-only: it never opens a surface or focuses a client. JSON returns `id` and `itemId` for the requested checkout and `rootItemId` for its parent (all equal for a root). Text prints `ID: <requested-id>` and `Root: <root-id>`. Open explicitly with `work-craft surface ensure --item <requested-id>`.

Filter by basename, branch, absolute or home-relative path. Tab/Shift+Tab cycles filter and results; Ctrl+n in the filter enters the first actual match. Enter in the filter does not open anything. Results use List browsing/paging; h/Left, l/Right and Space collapse/expand roots when not filtering. Filters and expansion stay local per workspace/category and never change the active workbench.

Missing worktrees remain selectable and marked unavailable. An unavailable primary stays the parent; a valid linked checkout can supply discovery without promoting itself. `a` requests Archive on an unavailable Coding result; terminals keep running. Archiving a root hides its descendants without deleting them. Restore is explicit through CLI/API, never registration or discovery.

Bare repositories remain plain-directory targets; linked worktrees backed only by a bare repository are rejected because there is no primary non-bare checkout. Git `--separate-git-dir` layouts whose primary checkout is absent from Git's worktree registry are also rejected, rather than guessing a checkout from the metadata directory's parent. Identity is path-based: replacing/reinitializing a repository at the same checkout/common-directory paths is not detected as a new incarnation. Moved linked paths may leave an unavailable old child plus a new child. Registration/discovery never retargets, merges, or restarts existing terminals.

From a running terminal, `Hyper+[` / `Hyper+]` switches to the adjacent tab and enters its remembered running pane (otherwise its first usable running pane). Switching from the tab strip or another shell control preserves that scope; a boundary does not drop terminal focus. Entry waits for running/native readiness and usable geometry, and newer input/navigation cancels stale handoffs. `Hyper+n` creates a tab. Leader is `Ctrl+Space`.

Stopped panes retain output/history. When the focused pane stops, native input focus moves to the tab strip while preserving the selected pane for `leader+r` explicit restart. Typing/pasting cannot restart or send input to a stopped pane. Ordinary child stderr stays terminal output. The precise previously reported status/scroller flicker has not been reproduced; physical-terminal visual/focus acceptance remains pending.

Navigation docks at 120+ columns, opens as a body-only drawer at 80–119, and is blocked below 80 by a resize message. Escape dismisses the drawer; successful terminal entry closes it without remounting terminals. Operational failures appear as source-labelled, eight-second status messages; field validation remains beside its field. Failed sources retain compact indicators after text expires. Child-program output stays in its terminal.

### Workbench presentation (Phase 5)

The two-row library Tabs strip switches the displayed tab while browsing, without entering its terminal. Enter/Space or primary-button release (including reclicking the selected tab) requests entry after authoritative selection and native readiness. Newer intent cancels pending entry. Tabs share horizontal overflow arrows, wheel scrolling and candidate reveal; labels are not truncated. Terminal renderers intentionally remain native OpenTUI leaves outside generic TabsContent mounting.

The accepted Oct 19 styling uses a three-row header/workspace bar, two-row Tabs, a one-row pane top border and one-cell horizontal workbench padding, without an outer workbench border. The status bar stays one row at the bottom and is never covered or dimmed by application overlays. Running terminals have no footer; all terminal output is transparent and undimmed. Unavailable panes have a bordered, three-row bottom Alert (warning for exited/disconnected panes). Only exited panes show Reactivate, with warning background and background-colored text when enabled/unfocused; normal focused/disabled Button colors still apply. Reach it with spatial keyboard navigation or click it to start one fresh shell in that exact pane, retaining history. Explicit tab entry prefers a usable running pane; otherwise it can focus the selected exited pane's action without pressing it. No Archive or automatic restart is added. Tiny panes clip the Alert within their own bounds.

`Ctrl+Space`, then `v` splits side-by-side; `s` splits top/bottom. Both inherit the owned shell's live cwd after `cd`, not a foreground child's private cwd. Discovery failure reports an actionable status error without changing layout. Each successful split directionally equalizes the whole affected tab, preserving topology, other tabs, existing shell PIDs and output. Splits still exist when too small; terminal input requires an actual 20-column by five-row viewport. Reactivate requires a 20-column by four-row pane. Successful split, `Hyper+n` tab creation and explicit restart enter only their exact ready destination; newer intent cancels the handoff.

CLI `pane split` without `--cwd` uses the same live-cwd discovery. An explicit `--cwd` is resolved relative to the CLI's directory and overrides discovery; invalid/unavailable directories exit nonzero without adding a pane. Text remains `Pane: <pane-id>`; JSON contains `id`, `paneId`, `surfaceId` and `tabId`. macOS discovery uses bounded `/usr/sbin/lsof`; Linux uses `/proc/<shell-pid>/cwd`. **Linux live-cwd acceptance is unverified in this Darwin-host checkpoint.**

The [Phase 5 checkpoint](docs/superpowers/specs/2026-10-18-tui-component-adoption-phase-5-design.md) is accepted for progression, with independent whole-session/follow-up review and split/tab/restart focus repairs complete. Phase 6 consolidation and its connected review are complete, with no review findings or production changes. Its fresh macOS `bun run check` passed 1,399 tests, zero failures, lint/format/types, build and compiled smoke. The user accepted all component-adoption work as complete on 2026-10-19; architectural Stage 2 remains unstarted. Injected default/Dracula tests are not a runtime theme-switching feature or physical-terminal contrast certification; Linux live-cwd and long-running listener stability remain unverified limits.

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

Schema 4 intentionally rejects incompatible development databases (including schema 3) rather than migrating or deleting them. Old independent-worktree records/surfaces are not merged. Prefer a fresh `WORK_CRAFT_HOME` for experiments; no automatic reset occurs. Only after deciding to discard development records, close reconnecting TUI/watch clients, resolve/show and confirm the concrete selected home and `work-craft.sqlite` path plus shutdown/reset scope, then run `WORK_CRAFT_HOME=<confirmed-home> work-craft daemon destroy --force` using a compatible executable. This stops/reaps managed terminals before removing only Work Craft's SQLite database/sidecars; it never deletes registered directories, source work, or Git metadata. Do not delete the entire state directory or remove a live daemon's lock/socket manually. Restart all clients coherently on the new version. No default-home reset is part of this follow-up's verification.

## First Slice Boundaries

Category-specific screens, `gh`/`az` views, Neovim/OpenCode metadata integration, remote access, and agent automation are outside this slice.

Run the complete correctness gate with `bun run check`. It includes linting, formatting, typechecking, tests, a current-host standalone build, and a packaged executable smoke test covering daemon startup and the compiled TUI.

To run checks individually, use `bun run lint`, `bun run format:check`, `bun run typecheck`, or `bun run test`.

## License

[MIT](LICENSE)
