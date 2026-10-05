# TUI Source Organization Design

## Goal

Reorganize `packages/tui/src` so its directory and file structure exposes the
TUI's architectural capabilities and its concrete persistent-shell regions.
Preserve all current behavior while decomposing the root shell and its broad
renderer test into focused owners.

This is an organizational refactor of the existing React/OpenTUI client. It
does not change server ownership, protocol contracts, shell behavior, keyboard
routing, responsive layout, terminal lifecycle, or visual design.

## Constraints

- Preserve the local-first, single-daemon architecture and keep the TUI a
  disposable client.
- Preserve `@work-craft/server/client` as the TUI's only server import boundary.
- Preserve rendered IDs, labels, command IDs, key routing, focus behavior,
  protocol commands, regional errors, and reconnect behavior.
- Preserve stable terminal identity, keyed ancestry, registration order,
  replay behavior, input forwarding, and resize behavior.
- Keep tests colocated with the source or visible component they exercise,
  except genuinely cross-capability acceptance support.
- Keep the local theme contract in `ui/` and use native OpenTUI
  primitives until concrete reuse justifies a local component.
- Do not add barrel files, a generic `shared`, `utils`, or `helpers` directory,
  a state library, a command bus, or dependency-inversion abstractions.
- Do not create category or built-in-pane structures before those capabilities
  have approved designs and concrete behavior.

## Decision

Use a hybrid capability organization with concrete UI elements represented by
recognizable files inside their owning capability.

The TUI has two real organizational axes:

1. Global client mechanisms such as synchronization, input routing, focus, and
   shell orchestration.
2. Product capabilities such as navigation and the workbench.

A purely feature-first structure would force the global command and focus
policies across thin feature directories before those features own distinct
behavior. A technical-layer structure would scatter each future workbench or
category change across state, layout, and component directories. The hybrid
keeps genuinely global mechanisms centralized while allowing concrete product
capabilities to evolve together.

The server's capability-oriented organization is precedent for making real
ownership boundaries visible, not a directory template to copy. Backend
folders such as `api`, `application`, `daemon`, and `persistence` do not map to
a React client.

## Target Structure

```text
packages/tui/src/
├── main.tsx
├── app.tsx
├── entrypoint.test.ts
├── test-fixtures.ts
├── demos/
│   ├── components.tsx
│   ├── controls.tsx
│   ├── demo-page.tsx
│   └── use-demo-theme.ts
├── client/
│   ├── use-work-craft.test.ts
│   └── use-work-craft.ts
├── input/
│   ├── command-router.test.ts
│   ├── command-router.ts
│   ├── focus.test.ts
│   └── focus.ts
├── shell/
│   ├── commands.test.ts
│   ├── commands.ts
│   ├── create-prompt.tsx
│   ├── dialog-overlay.tsx
│   ├── header.tsx
│   ├── layout.test.ts
│   ├── layout.ts
│   ├── model.test.ts
│   ├── model.ts
│   ├── session-chooser.tsx
│   ├── session-switcher.tsx
│   ├── shell.test.tsx
│   ├── shell.tsx
│   ├── state.test.ts
│   ├── state.ts
│   ├── status-bar.tsx
│   └── workspace-bar.tsx
├── navigation/
│   ├── category-rail.tsx
│   ├── model.test.ts
│   ├── model.ts
│   ├── navigator.test.tsx
│   └── navigator.tsx
├── workbench/
│   ├── layout.test.ts
│   ├── layout.ts
│   ├── surface-view.test.tsx
│   ├── surface-view.tsx
│   ├── tab-bar.tsx
│   ├── terminal-pane.tsx
│   └── workbench.tsx
└── ui/
    ├── components/
    ├── controls/
    ├── extra/
    ├── primitives/
    ├── theme-provider.tsx
    ├── theme.ts
    └── themes/
        └── default.ts
```

This tree describes ownership, not a requirement to create an empty or
perfectly symmetrical file grid. A listed test file is created only when
existing tests naturally move to that owner or new non-trivial pure logic needs
coverage.

`ui/` owns theme types, values, context, reusable controls and composites, and
their local focus/hint helpers. Application capabilities
use native OpenTUI primitives directly until repeated behavior warrants a local
UI component.

## Capability Ownership

### Root Entrypoints

- `main.tsx` remains the OpenTUI renderer bootstrap and terminal registration
  point.
- `app.tsx` remains the small provider and application composition root.
- `entrypoint.test.ts` remains at the root because it exercises the real TUI,
  daemon, PTY, and executable path. Its repository-root calculation is
  sensitive to directory depth.
- `test-fixtures.ts` remains at the root while it supports tests across several
  capabilities.

### Standalone Demos And Reusable UI

`demos/` owns development-only compositions of the component library and their
colocated behavioral tests. `main.tsx` selects the controls or composite demo
with `CONTROLS_DEMO=true` or `COMPONENTS_DEMO=true`; the default remains `App`.
The former root `ui-demo.tsx` is now `demos/controls.tsx`. Shared demo layout,
background-focus policy, and theme/width cycling remain in `demos/`, while
reusable Container/ScrollArea primitives and named composites remain in `ui/`.

The implemented composites are Card, Badge, Alert, Spinner, Progress,
Collapsible, Accordion, and Tabs. Further components are follow-up work, not
part of the current delivered inventory. Application-specific shell and
workbench components retain their capability owners.

### Client

`client/` owns daemon communication and synchronized client state:

- connection and reconnection lifecycle;
- coherent snapshots, epochs, and revisions;
- stream attachment;
- terminal history and live-output buffers;
- rejecting durable commands while disconnected.

It does not own shell selection, viewport state, focus, or rendering.

### Input

`input/` owns global input interpretation:

- key and modifier recognition;
- direct, leader, Hyper, dialog, and passthrough routing priority;
- command metadata and contextual hints;
- pure spatial focus projection and movement.

The router emits semantic command IDs. It does not execute product behavior or
send server commands.

### Shell

`shell/` owns persistent-shell coordination and local presentation state:

- local state, reconciliation, dialogs, prompts, and regional errors;
- responsive shell geometry and cross-region focus-node geometry;
- derivation of the visible shell context;
- command availability and execution coordination;
- top-level composition and input wiring;
- header, workspace bar, session switcher, status bar, and dialogs.

The shell imports capabilities and wires them together. Other capabilities do
not import from the shell.

### Navigation

`navigation/` owns the common organizational navigator:

- projection of snapshots into ordered workspaces, categories, projects, and
  visible item rows;
- the invariant category rail;
- expanded and compact project/item navigator rendering.

It does not own durable navigation state. Stage 2 will move active navigation
to the daemon while local cursors, expansion, and viewport state remain in the
TUI.

### Workbench

`workbench/` owns active execution-surface presentation:

- tabs and tab activation presentation;
- split-tree projection and pane traversal;
- workbench frame, regional errors, and empty or undersized states;
- recursive surface rendering;
- terminal rendering, replay, input, resize, and stable identity.

It renders daemon-owned layouts and sends semantic actions upward. It does not
perform durable split-tree mutations locally.

## Concrete UI Components

The source tree must expose the persistent shell's visible structure directly:

```tsx
<Header>
  <WorkspaceBar />
  <SessionSwitcher />
</Header>
<CategoryRail />
<Navigator />
<Workbench>
  <TabBar />
  <SurfaceView />
</Workbench>
<StatusBar />
<DialogOverlay />
```

These files own meaningful regions rather than acting as one-line wrappers:

- `header.tsx` owns top-row geometry and composition.
- `workspace-bar.tsx` owns workspace viewport rendering and mouse activation.
- `session-switcher.tsx` owns session identity and connection treatment.
- `category-rail.tsx` owns the fixed category region.
- `navigator.tsx` owns expanded and compact hierarchy rendering.
- `workbench.tsx` owns its frame, errors, empty states, undersized state, tab
  bar, and active surface content.
- `tab-bar.tsx` owns tab rendering and activation.
- `status-bar.tsx` owns mode and contextual hint presentation.
- `dialog-overlay.tsx` owns overlay behavior and selects the concrete dialog
  body.
- `surface-view.tsx` owns recursive layout rendering.
- `terminal-pane.tsx` remains the lifecycle-sensitive terminal leaf.

The former generic `shell-regions.tsx` was removed. Application components do
not move into a generic `components/` directory because their capability path
already communicates ownership.

## Shell Decomposition

Before this refactor, `shell.tsx` combined data projection, geometry, command
policy, protocol translation, async completion handling, input registration,
dialogs, and rendering. The refactor separates those responsibilities without
creating a framework:

- `shell.tsx` retains React hooks and effects, terminal references, top-level
  composition, and capability wiring.
- `model.ts` purely derives the visible session, workspace, category,
  navigation, surface, tab, pane, and cursor-index context from a snapshot and
  local state. It does not interpret terminal dimensions.
- `commands.ts` owns durable command constructors, command availability,
  stale-completion guards, semantic command execution, and create submission.
- `state.ts` owns the local reducer and snapshot reconciliation. Shared active
  selections remain here only until Stage 2 moves them to daemon state.
- `layout.ts` owns shell dimensions, navigator mode and width, workspace
  viewport calculations, and cross-region focus-node geometry.

`CreateKind` becomes a model or command type rather than being imported from a
React component by `state.ts`.

`workbench/layout.ts` becomes the canonical split-tree projection and pane
traversal module. It removes the duplicate pane-ID traversal currently present
in shell state and surface rendering. Focus geometry may retain its own
traversal because it computes rectangles rather than merely collecting pane
IDs.

## Dependency Shape

```text
main.tsx
  └── app.tsx
      └── shell/shell.tsx
          ├── client/
          ├── input/
          ├── navigation/
          ├── workbench/
          └── local theme foundation and native OpenTUI primitives

client/ ─────────────→ @work-craft/server/client
input/ ──────────────→ server client types; no product capability
navigation/ ─────────→ server client types + UI foundation
workbench/ ──────────→ client + server client types + UI foundation
shell/ ──────────────→ client + input + navigation + workbench + UI foundation
```

`client`, `input`, `navigation`, and `workbench` must not import from `shell`.
The UI foundation must not import application code. Direct imports remain
appropriate; no barrel or inversion layer is introduced.

## Data And Command Flow

State continues to flow in one direction:

```text
daemon snapshot or stream
  → client/use-work-craft.ts
  → shell/model.ts
  → named UI components
```

Interactions continue through semantic commands:

```text
keyboard or mouse action
  → input/command-router.ts
  → semantic command ID
  → shell/commands.ts
  → local reducer action or daemon Command
  → next coherent snapshot
```

Components receive data and semantic callbacks through props. They do not
import the client store or install competing global keyboard handlers.

`terminal-pane.tsx` remains the deliberate exception: it uses the existing
stream for PTY input and resize because those operations belong to its runtime
lifecycle and do not mutate durable business state locally.

## Failure Handling

The refactor preserves current failure ownership:

- connection state stays in `client/`;
- command failures remain associated with the initiating shell region;
- failed or interrupted processes remain visible inside their pane;
- the last coherent snapshot stays visible while reconnecting;
- durable mutations remain disabled while disconnected;
- a failure in one pane does not unmount unrelated panes.

Moving or extracting components must not alter terminal keys, keyed ancestry,
conditional mounting, terminal registration order, or replay cursors.

## Test Organization

Tests move with the behavior they verify:

- router and focus tests move to `input/`;
- store, reconnect, revision, and terminal-buffer tests move to `client/`;
- navigation projection and navigator rendering tests move to `navigation/`;
- layout projection, terminal identity, and surface rendering tests move to
  `workbench/`;
- state, shell geometry, command coordination, dialogs, chrome, and
  cross-capability rendering tests move to `shell/`;
- real process and PTY acceptance remains in root `entrypoint.test.ts`.

The former broad root `shell.test.tsx` was split by these behavioral owners.
Only cross-capability composition, routing, terminal mount preservation, and
regional failure behavior remain in `shell/shell.test.tsx`.

File movement alone does not require new behavioral tests. Newly extracted
non-trivial pure logic receives focused tests when existing coverage cannot be
moved intact.

## Migration Sequence

1. Move already cohesive files and colocated tests into `client/`, `input/`,
   `navigation/`, `shell/`, and `workbench/`. Update imports only and run the
   affected tests.
2. Replace `shell-regions.tsx` with named visible components. Extract `Header`,
   `Workbench`, and `DialogOverlay` from `shell.tsx` while preserving rendered
   IDs and terminal ancestry. Run shell, navigation, and workbench render tests.
3. Extract `shell/model.ts`, `shell/commands.ts`, and the canonical
   `workbench/layout.ts`. Reduce `shell.tsx` to orchestration and composition.
   Run pure, store, and render tests.
4. Split `shell.test.tsx` by the new owners, retain cross-capability coverage,
   and run the complete verification suite.

Every slice must leave the normal TUI entry point runnable. No temporary `v2`
entry point or duplicate presentation path is introduced.

## Verification

The refactor is complete when:

1. Source and colocated tests match the approved capability and visible-region
   structure.
2. `shell.tsx` is an orchestration and composition root rather than the owner of
   every shell responsibility.
3. The visible shell regions have recognizable source files.
4. The existing behavioral tests pass from their new locations.
5. The real TUI entrypoint and PTY acceptance coverage pass.
6. `bun run check` passes, including type checking, linting, formatting, tests,
   production build, and build smoke verification.

## Deliberate Exclusions

- Changing the protocol, durable state, or server/client ownership boundary.
- Implementing daemon-owned shared navigation from Stage 2.
- Implementing Stage 3 workbench operations or Stage 4 built-in panes.
- Creating six category feature directories before category behavior exists.
- Introducing generic component, hook, service, store, command, or plugin
  frameworks.
- Creating reusable UI wrappers before concrete duplication requires them.
- Renaming rendered IDs, labels, commands, or key bindings.
- Broad visual snapshot testing.
