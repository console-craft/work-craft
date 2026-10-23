import type { CategoryKind } from "../api/protocol.ts";

export const CATEGORIES: readonly { kind: CategoryKind; title: string; position: number }[] = [
  { kind: "inbox", title: "Inbox", position: 0 },
  { kind: "today", title: "Today", position: 1 },
  { kind: "design", title: "Design", position: 2 },
  { kind: "implementation", title: "Implementation", position: 3 },
  { kind: "collaboration", title: "Collaboration", position: 4 },
  { kind: "operations", title: "Operations", position: 5 },
];
