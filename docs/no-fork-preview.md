# Stock OpenTUI preview

This is an experimental build, not a drop-in replacement or a performance result.
It uses the normal application, daemon and PTYs with unmodified registry OpenTUI
core/React **0.6.6**, React **19.3.0**, and no fork-backed fallback.

## Launch

```sh
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-preview" \
  /Users/ovi/.local/share/opencode/worktree/c4185d/no-fork-terminal-performance/dist/work-craft-preview
```

Choose **Playground** (or **Focus**) in the session picker. The shared workspace
contains five Design items. **Rendering playground** already has two tabs and
three shell panes, rooted in this checkout. Enter the item/first shell pane.
The first pane prints a labelled rendering example on each new daemon start,
then becomes an ordinary interactive `/bin/sh`.

The default home is `$XDG_STATE_HOME/work-craft-preview`, or
`$HOME/.local/state/work-craft-preview`; explicit `WORK_CRAFT_HOME` wins.
The command above pins the seeded home regardless of your XDG settings. It does
not replace `/Users/ovi/.local/bin/work-craft` or use the normal Work Craft home.

## A few things to try

- Look at `RI: |🇦🇧|X`: the known defect shows spaces between the regional indicators.
  `X` should still align with column 10 on the ruler. Compare wide/combining text
  and the coloured blank cells underneath.
- Type a command, paste some Unicode, and try `nvim` or another real terminal app.
- Switch tabs, split a pane, open/close a dialog, and check where typing lands.
- Open the same launch command in a second terminal. The same session mirrors
  navigation; choosing the other session gives independent navigation over the
  shared workspace. Resize either window, then quit/reopen a client.

No testing script is needed. Benchmarks, soak and an assistant-led tour wait for
your next prompt.

## Stop, relaunch, reset

Quit a client with **Hyper+q** (the daemon and shells remain alive). Relaunch with
the command above. To stop the preview daemon and its owned shells:

```sh
WORK_CRAFT_HOME="$HOME/.local/state/work-craft-preview" \
  /Users/ovi/.local/share/opencode/worktree/c4185d/no-fork-terminal-performance/dist/work-craft-preview daemon stop
```

Stopping preserves records/history; relaunch creates fresh shell processes. The
labelled example reappears in its seeded pane. Do not run the installed old binary
against this home. Incompatible daemon identities are rejected, not killed/reused.

Optional developer reset, from this checkout:

```sh
bun scripts/seed-preview.ts "$HOME/.local/state/work-craft-preview" --reset
```

This stops the compatible daemon, makes and integrity-checks a SQLite backup in
`<home>/backups/before-reseed-<timestamp>.sqlite`, performs managed destruction,
then reseeds. Existing state is refused without `--reset`. Unrelated files are
not removed. Reset ends with the daemon stopped.

## Known limits

- **Regional-indicator glyph fidelity is waived only for this preview.** Positions
  are retained, but `🇦🇧` may appear as `🇦 🇧 `. This is not fixed or equivalent.
- Cold durable output is retained in SQLite but is not restored as a new shell's
  display/modes. An exited runtime retains one picture, not browsable scrollback.
- Native pastes above **1 MiB** fail explicitly (also a limit of the fork-backed
  control). No truncation or multi-encode workaround is used.
- Highly varied large frames may exceed the **8 MiB** material/envelope limit and
  show a scoped terminal error. Ordinary supported dimensions were not reduced.
- Hyperlink destinations and invisible-wide second-cell styling are research-only
  gaps; this preview is not approval to ship those losses.
- Input acknowledgement confirms native PTY buffering drained, not that a program
  processed the input. Linux, performance parity, sustained load and physical
  terminal fidelity are not certified.

## Build evidence

From this checkout: `bun run preview:build`, then `bun run preview:smoke`.
The executable's `.provenance.json` and `.graph.json` sidecars live next to it in
`dist/`. The build verifies installed core/React/native files against registry
archives and lock integrity, audits the compiled graph, and records executable,
lockfile and native SHA-256 hashes. Native asset environment overrides are rejected.
The smoke relocates the binary into a path with spaces, runs its real daemon and
shell outside this checkout, checks current material and semantic input, and
confirms owned shutdown. These are development checks, not manual acceptance.

See the [dated handover](superpowers/handovers/2026-10-22-unpatched-runnable-preview.md)
for the exact verification record.
