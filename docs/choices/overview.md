# Choices

[Overview](../overview.md) / Choices

Topic 3 of 4

[Previous: Foundations](../foundations/overview.md) | [Next: Development guide](../development.md)

The current design commits to local daemon ownership, daemon-side terminal
interpretation, and a durable work graph with shared session selection. These
choices provide useful boundaries, but each ties different consumers together.
The following pages assess present dependencies and change scope; they do not
claim undocumented historical motivation.

1. [Local service and storage](local-service.md) assesses the local Unix socket,
   Bun runtime, SQLite owner, and single executable delivery.
2. [Terminal authority](terminal-authority.md) assesses daemon-side parsing,
   portable material, semantic input, and the native OpenTUI adapter.
3. [Durable work model](durable-work-model.md) assesses reusable workspaces,
   shared session navigation, fixed categories, item hierarchy, and schema evolution.

Each page labels changeability at the scope where a change can be evaluated.
A narrow adapter change and a redistribution of terminal ownership have very
different consequences even though both involve the same library.

[Previous: Foundations](../foundations/overview.md) | [Next: Development guide](../development.md)
