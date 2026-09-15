# Bun Workspace Design

## Goal

Initialize this repository as a Bun workspace containing three packages: `server`, `tui`, and `cli`.

## Structure

```text
.
├── package.json
├── bun.lock
├── .gitignore
└── packages
    ├── server
    │   └── package.json
    ├── tui
    │   └── package.json
    └── cli
        └── package.json
```

The private root package declares `packages/*` as its workspaces. Each child package is private and contains only its package manifest.

## Scope

No source files, scripts, dependencies, shared package, or TypeScript configuration will be added. Those belong to later work once each package's responsibilities are defined.

## Verification

Run `bun install` from the repository root. It must discover all three workspaces, complete successfully, and generate `bun.lock`.
