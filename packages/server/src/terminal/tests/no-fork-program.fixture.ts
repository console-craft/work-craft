import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";

const log = process.argv[2]!;
writeFileSync(log, "");
process.stdin.setRawMode(true);
process.stdin.on("data", (bytes: Buffer) => {
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    const input = bytes.subarray(offset, offset + 65536).toString("base64");
    appendFileSync(log, JSON.stringify({ input }) + "\n");
    process.send?.({ input });
  }
});
let written = 0;
process.on("message", (value: unknown) => {
  const message = value as { token: number; bytes: number[] };
  assert(Number.isSafeInteger(message.token));
  assert(Array.isArray(message.bytes) && message.bytes.length <= 8 * 1024 * 1024);
  assert(message.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255));
  written += message.bytes.length;
  const end = written;
  process.stdout.write(new Uint8Array(message.bytes), () =>
    process.send?.({ token: message.token, written: end }),
  );
});
process.once("disconnect", () => process.exit(0));
process.send?.({ ready: true });
