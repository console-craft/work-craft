import type { EmbeddedTerminalRenderable } from "@opentui/core";

/** Bounded outer-display evidence; parsing cost belongs to the harness, not the app. */
export function createTerminalObservation(terminal: EmbeddedTerminalRenderable): {
  write(bytes: Uint8Array): void;
  retained(): Uint8Array;
  bytes(): number;
  parseMs(): number;
  frame(): string;
  cursor(): { x: number; y: number; visible: boolean };
} {
  const ring = new Uint8Array(262144);
  let end = 0;
  let total = 0;
  let parsing = 0;
  return {
    write(bytes) {
      const started = performance.now();
      terminal.write(bytes);
      parsing += performance.now() - started;
      total += bytes.byteLength;
      const tail = bytes.subarray(Math.max(0, bytes.byteLength - ring.byteLength));
      const first = Math.min(ring.byteLength - end, tail.byteLength);
      ring.set(tail.subarray(0, first), end);
      ring.set(tail.subarray(first), 0);
      end = (end + tail.byteLength) % ring.byteLength;
    },
    retained() {
      if (total < ring.byteLength) {
        return ring.slice(0, total);
      }
      const result = new Uint8Array(ring.byteLength);
      result.set(ring.subarray(end));
      result.set(ring.subarray(0, end), ring.byteLength - end);
      return result;
    },
    bytes: () => total,
    parseMs: () => parsing,
    frame: () => terminal.screen().text,
    cursor: () => terminal.screen().cursor,
  };
}
