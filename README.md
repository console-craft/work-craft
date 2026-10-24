# Work Craft

**Keep your work organized. Keep your terminals running.**

Work Craft is a local-first terminal work organizer for people who live in the
command line. Group your work into sessions and workspaces, navigate repositories
and worktrees, and return to your shells without rebuilding your setup each time.

## Your work, in one place

- **Organize by context.** Create named sessions and reusable workspaces, with
  Inbox, Today, Design, Coding, Collaboration and Operations categories.
- **Give each item room to work.** Open an item into its own terminal workspace
  with tabs and split panes. Root items and their children can each have one.
- **Bring your existing repositories.** Register a directory and browse its linked
  Git worktrees. Work Craft never changes branches or creates/deletes checkouts.
- **Leave and come back.** Close the interface without stopping running shells or
  programs. Reopen it to pick up where you left off.
- **Share a session across terminals.** Multiple clients see the same navigation
  and running programs—including one shared editor—while keeping their own focus,
  filters and drafts. Different sessions can use the same workspaces independently.
- **Keep useful history.** Retained output stays scrollable after a shell exits.
  Restart a stopped shell explicitly without losing its retained scrollback.
- **Automate from the CLI.** Create and select work, inspect state and manage
  terminals with plain-text or JSON output. No interactive prompts required.

Everything stays on your machine. Work Craft runs locally on macOS and Linux;
there is no hosted service or remote-access setup.

## Install

Download the matching archive from [GitHub Releases](https://github.com/console-craft/work-craft/releases):

| Platform            | Archive suffix |
| ------------------- | -------------- |
| Apple Silicon macOS | `darwin-arm64` |
| x86-64 glibc Linux  | `linux-x64`    |

For example, on Apple Silicon macOS, replace `X.Y.Z` with your downloaded version:

```sh
tar -xzf work-craft-vX.Y.Z-darwin-arm64.tar.gz
mkdir -p ~/.local/bin
install -m 755 work-craft ~/.local/bin/work-craft
```

Make sure `~/.local/bin` is on your `PATH`. Intel macOS, Linux ARM64 and musl Linux
do not currently have supported prebuilt releases.

## Get started

Run `work-craft` to open the interface; its background service starts automatically.

1. On a fresh installation, press `Ctrl+Space`, then `n` in the session chooser to
   create your first session.
2. Move focus with `Ctrl+h/j/k/l`. Focus the workspace bar and press `n` to create
   a workspace, then choose a category.
3. In Coding results, press `n` to register an existing directory. Its terminal
   opens when registration succeeds. In other categories, create a generic item
   and open it with Enter.
4. Add tabs or splits, run your tools, and quit with `Hyper+q` when you're done.
   Your programs keep running; launch `work-craft` again to reconnect.

The bottom status bar shows actions for the focused area. **Leader** means
`Ctrl+Space`, followed by another key. **Hyper** needs a terminal/key mapping that
sends Hyper or the supported Ctrl+Alt/Option+Super combination.

| Keys                    | Action                                       |
| ----------------------- | -------------------------------------------- |
| `Ctrl+h/j/k/l`          | Move focus between regions and panes         |
| `Hyper+s`               | Choose a session                             |
| `Hyper+h/l`             | Previous/next category                       |
| `Hyper+k/j`             | Open the previous/next item                  |
| `leader+b`              | Show/hide the navigator                      |
| `Hyper+n`               | New terminal tab                             |
| `Hyper+[` / `Hyper+]`   | Previous/next tab                            |
| `leader+v` / `leader+s` | Split side-by-side / top-bottom              |
| `leader+r`              | Explicitly restart the selected stopped pane |
| `Hyper+r` / `Hyper+q`   | Reconnect / quit the interface               |

You can also script Work Craft:

```sh
work-craft session create --name Main --json
work-craft snapshot --json
work-craft daemon status
```

## A few things to know

- Use a terminal at least 80 columns wide. The navigator docks in wider windows
  and becomes a drawer in narrower ones.
- Closing the interface leaves programs running. `work-craft daemon stop` stops
  the background service and its terminals while preserving saved work/history.
- After a service or machine restart, Work Craft restores retained output and
  starts fresh shells where appropriate—not the memory of your previous editor
  or other running applications. Already stopped shells stay stopped.
- History is bounded, not an unlimited archive. Terminal rendering still has
  known Unicode/hyperlink limitations, and a macOS PTY exit hang remains under
  investigation. See [runtime limitations](docs/architecture/references/terminal-lifecycle.md#known-limitations-and-unresolved-risks).
- Non-Coding categories currently provide generic items and terminal workspaces,
  not specialized task, GitHub or Azure DevOps screens.

## Building or contributing?

Start with the [architecture overview](docs/architecture/overview.md),
[development guide](docs/architecture/references/development.md) and
[agent guidelines](AGENTS.md). Released changes are in the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE)
