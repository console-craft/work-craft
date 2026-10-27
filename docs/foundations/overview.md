# Foundations

[Overview](../overview.md) / Foundations

Topic 2 of 4

[Previous: Capabilities](../capabilities/overview.md) | [Next: Choices](../choices/overview.md)

The daemon combines four fundamental mechanisms with different identities and
lifetimes. Transactions save work; stamped connections authorize interaction;
a live parser interprets each terminal; bounded history makes output available
after a process or service lifetime ends. Keeping these mechanisms distinct is
necessary to reason about reconnects and recovery.

1. [Daemon and durable state](daemon-state.md) explains service startup, local
   ownership, transactions, SQLite compatibility, and shutdown.
2. [Client coordination](client-coordination.md) explains snapshots, attachments,
   shared cursors, freshness identities, and terminal size arbitration.
3. [Terminal display and input](terminal-display.md) explains the authoritative
   terminal parser, portable pictures, semantic input, and presentation ordering.
4. [Terminal history and recovery](terminal-history.md) explains byte retention,
   geometry markers, safe cold replay, and stopped-pane browsing.

A metadata snapshot, an output cursor, a runtime generation, and a rendered picture
answer different questions. None can replace all the others. The owning pages
explain where each is used, including the failure consequences of accepting an
old answer after its context has changed.

[Previous: Capabilities](../capabilities/overview.md) | [Next: Choices](../choices/overview.md)
