// oxlint-disable-next-line no-restricted-imports -- Test-only plain projection DTOs.
import type {
  ProjectionInput,
  ProjectionStamp,
  SemanticInput,
} from "../../../../../scripts/test-support/terminal-projection-types";

type Sender = (event: ProjectionInput, signal: AbortSignal) => Promise<void>;

export function sameProjectionStamp(a: ProjectionStamp, b: ProjectionStamp): boolean {
  return (
    a.epoch === b.epoch &&
    a.runtime === b.runtime &&
    a.attachment === b.attachment &&
    a.navigation === b.navigation &&
    a.geometry === b.geometry
  );
}

/** Test-owned finite queue: captured sender/stamp, with queued plus in-flight accounting. */
export function projectionInputQueue(): {
  readonly bytes: number;
  enqueue(input: SemanticInput, stamp: ProjectionStamp, sender: Sender): void;
  clear(): void;
  flush(current: () => ProjectionStamp): Promise<void>;
} {
  const entries: { event: ProjectionInput; sender: Sender; charge: number }[] = [];
  let bytes = 0;
  let draining = false;
  let active: AbortController | undefined;
  return {
    get bytes() {
      return bytes;
    },
    enqueue(input: SemanticInput, stamp: ProjectionStamp, sender: Sender): void {
      const payload =
        input.kind === "paste"
          ? input.bytes.length
          : input.kind === "key"
            ? Buffer.byteLength(input.key.key ?? "") + Buffer.byteLength(input.key.text ?? "")
            : 0;
      const charge = payload + 128;
      if (bytes + charge > 8 * 1024 * 1024) {
        throw new Error("Projection input limit");
      }
      entries.push({ event: { stamp: { ...stamp }, input }, sender, charge });
      bytes += charge;
    },
    clear(): void {
      for (const entry of entries.splice(0)) {
        bytes -= entry.charge;
      }
      active?.abort();
    },
    async flush(current: () => ProjectionStamp): Promise<void> {
      if (draining) {
        throw new Error("Projection queue already draining");
      }
      draining = true;
      try {
        while (entries.length) {
          const entry = entries.shift()!;
          try {
            if (!sameProjectionStamp(entry.event.stamp, current())) {
              continue;
            }
            active = new AbortController();
            await entry.sender(entry.event, active.signal);
          } finally {
            bytes -= entry.charge;
            active = undefined;
          }
        }
      } finally {
        draining = false;
      }
    },
  };
}
