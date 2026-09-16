# Work Craft

A local-first terminal application shell for organizing work and opening persistent execution surfaces containing terminal and built-in panes.

Work Craft is currently an architecture and workspace scaffold. See the [architecture design](docs/superpowers/specs/2026-09-16-work-craft-architecture-design.md) for the product model, persistence contract, and first implementation slice.

## Requirements

- [Bun](https://bun.sh/)

## Setup

```sh
bun install
```

## Workspace

- `packages/server` - authoritative Bun daemon, persistence, PTYs, and local API
- `packages/tui` - disposable React/OpenTUI client
- `packages/cli` - non-interactive Unix-style client

## CLI

Clients start the local daemon on demand. The server remains the authority for durable state and runtimes; the CLI only parses arguments, calls the server, and prints plain text or JSON.

```sh
bun run cli -- status
bun run cli -- list
bun run cli -- open <item-id>
bun run cli -- stop
```

## Development

```sh
bun run check
```

To run checks individually, use `bun run lint`, `bun run format:check`, `bun run typecheck`, or `bun run test`.

## License

[MIT](LICENSE)
