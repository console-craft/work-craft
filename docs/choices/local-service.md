# Local service and storage

[Overview](../overview.md) / [Choices](overview.md) / Local service and storage

Topic 1 of 3

[Next: Terminal authority](terminal-authority.md)

Work Craft is built around one local authority per state directory. This lets a
client disappear without taking its shells or saved navigation with it. The
corresponding costs are a shared daemon failure domain, operating-system-specific
process handling, and a protocol that assumes filesystem access rather than
remote authentication.

## Local daemon and Unix socket

The implemented service uses Bun's HTTP/WebSocket server over a Unix socket.
Clients share that path through the same state-directory resolver, health check,
and startup/locking logic. Multiple state directories can isolate separate
instances; the code does not discover peers, replicate data, or coordinate several
daemons over one database.

**Changeability — Major migration:** A remote or distributed service changes more
than the transport address. Shell/PTY ownership, filesystem directory inspection,
path meaning, authentication, attachment trust, lock ownership, persistence, and
client startup all assume the local machine. An alternative requires an explicit
ownership/security/deployment model and coordinated protocol changes. Replacing
only HTTP transport inside the same local authority would be a smaller coordinated
change across server and client transport.

## Bun and one executable

The root dispatcher selects TUI, CLI, or internal daemon mode; the build compiles
it into one executable. Lazy imports select the appropriate entry point, while the
server package exposes a narrow client API to consumers. Bun is a runtime
commitment: SQLite, PTYs, subprocesses, HTTP serving, compilation, and native FFI
all appear in core boundaries. macOS/Linux support also depends on `ps`, Linux
`/proc`, and macOS `lsof` for specific lifecycle/cwd operations. Release packaging
currently targets macOS arm64 and glibc Linux x64.

**Changeability — Major migration:** Replacing Bun requires substitutes for those
runtime APIs plus compiled packaging and native terminal integration. TypeScript
alone is not the main coupling. Splitting CLI/TUI/daemon delivery while retaining
Bun is a **Coordinated change**: startup executable resolution, release packaging,
protocol compatibility, installation, and smoke validation must evolve together.

## SQLite as the durable authority

The daemon uses one synchronous SQLite connection and transaction closures to
couple catalog mutation with navigation normalization. This makes database state
immediately available to command authorization and snapshots. Output is buffered
before transactional flush, so persistence cost does not become a disk write for
every PTY callback. The design has neither an ORM repository abstraction nor a
storage-neutral application layer.

**Changeability — Major migration:** Replacing SQLite affects SQL-rich commands,
item identity constraints, cursor memories, byte/grid retention, transaction
ordering, schema compatibility, snapshots, and existing saved state. A new storage
engine would need a data migration and equivalent atomicity/foreign-key rules.
Tuning a history flush/retention policy is narrower but still needs evaluation
against crash loss, replay metadata, memory, and protocol response bounds.

## Source basis

[The dispatcher](../../src/main.ts),
[daemon lifecycle](../../packages/server/src/daemon/lifecycle.ts),
[client startup](../../packages/server/src/client/startup.ts),
[SQLite schema](../../packages/server/src/persistence/database.ts), and
[release workflow](../../.github/workflows/release.yml) establish these dependencies.
[Daemon state](../foundations/daemon-state.md) explains the runtime mechanism.

[Next: Terminal authority](terminal-authority.md)
