import type { TerminalSize } from "../api/protocol";
import type { HistoryReplay } from "./history";
import { createTerminalProjection, type TerminalProjection } from "./projection";

/** Replay owns no child: only generated, mode-free display can initialize the returned parser. */
export async function restoreColdProjection(
  history: HistoryReplay,
  size: TerminalSize,
): Promise<TerminalProjection> {
  let parser: TerminalProjection | undefined;
  let hasOutput = false;
  async function write(bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      parser!.write(bytes.subarray(offset, offset + 8192));
      parser!.replies();
      hasOutput = true;
      await Bun.sleep(0);
    }
  }
  try {
    if (history.data.length - history.prefixBytes !== history.cursor - history.startCursor) {
      throw new Error("Invalid retained byte range");
    }
    parser = createTerminalProjection(history.initialSize ?? size);
    await write(history.data.subarray(0, history.prefixBytes));
    let cursor = history.startCursor;
    let offset = history.prefixBytes;
    const starts = new Map(history.starts.map((start) => [start.sequence, start.runtimeStart]));
    for (const marker of history.resizes) {
      if (marker.cursor < cursor || marker.cursor > history.cursor) {
        throw new Error("Invalid retained resize cursor");
      }
      const next = offset + marker.cursor - cursor;
      await write(history.data.subarray(offset, next));
      cursor = marker.cursor;
      offset = next;
      const grid = { cols: marker.cols, rows: marker.rows };
      parser.resize(grid);
      parser.replies();
      const start = starts.get(marker.sequence);
      if (start) {
        const previous = parser;
        parser = undefined;
        const transcript = hasOutput
          ? await previous.takeDisplayTranscript("after-content")
          : undefined;
        previous.destroy();
        parser = createTerminalProjection(grid);
        if (transcript) {
          await write(transcript);
          if (start === "fresh") {
            await write(new TextEncoder().encode("\r\n".repeat(grid.rows) + "\x1b[H"));
          }
        }
      }
    }
    await write(history.data.subarray(offset));
    parser.resize(size);
    parser.replies();
    const previous = parser;
    parser = undefined;
    const transcript = await previous.takeDisplayTranscript("preserve");
    parser = createTerminalProjection(size);
    await write(transcript);
    return parser;
  } catch (cause) {
    parser?.destroy();
    throw new Error(
      `Cold history restoration failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
