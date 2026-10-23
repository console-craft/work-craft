import { toArrayBuffer } from "bun:ffi";

import {
  type ContextBufferHandle,
  type ContextEmbeddedTerminalHandle,
  type NativeContextHandle,
  type RenderLib,
  RGBA,
  TextAttributes,
} from "@opentui/core";

import type { TerminalSize } from "../api/protocol";

export const PROJECTION_CELL_LIMIT = 2 * 1_048_576;
export const PROJECTION_SCROLLBACK_LIMIT = 10000;
const TRANSCRIPT_LIMIT = 8 * 1024 * 1024;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const attributes = [
  [TextAttributes.BOLD, 1],
  [TextAttributes.DIM, 2],
  [TextAttributes.ITALIC, 3],
  [TextAttributes.UNDERLINE, 4],
  [TextAttributes.BLINK, 5],
  [TextAttributes.INVERSE, 7],
  [TextAttributes.HIDDEN, 8],
  [TextAttributes.STRIKETHROUGH, 9],
] as const;

function drawable(text: string, width: number): void {
  if (text.length === 1 && text >= " " && text <= "~" && width === 1) {
    return;
  }
  const iterator = graphemes.segment(text)[Symbol.iterator]();
  const columns = /^\p{Regional_Indicator}$/u.test(text) ? 2 : Bun.stringWidth(text);
  if (
    // oxlint-disable-next-line no-control-regex -- Only drawable cells may enter a generated transcript.
    /[\x00-\x1f\x7f-\x9f]/.test(text) ||
    iterator.next().done ||
    !iterator.next().done ||
    columns !== width
  ) {
    throw new Error("Invalid cold-history drawable cell");
  }
}

function color(color: RGBA, foreground: boolean): string {
  const base = foreground ? 38 : 48;
  // Native foregrounds are resolved pixels even when inverse retains default intent.
  return !foreground && color.intent === "default"
    ? String(base + 1)
    : `${base};2;${Math.round(color.r * 255)};${Math.round(color.g * 255)};${Math.round(color.b * 255)}`;
}

async function revealHistory(
  lib: RenderLib,
  context: NativeContextHandle,
  terminal: ContextEmbeddedTerminalHandle,
  target: ContextBufferHandle,
  size: TerminalSize,
): Promise<{ rows: number; cursor: { x: number; y: number } }> {
  lib.contextResizeBuffer(context, target, size.cols, size.rows);
  lib.contextEmbeddedTerminalScroll(context, terminal, PROJECTION_SCROLLBACK_LIMIT);
  lib.contextEmbeddedTerminalInvalidate(context, terminal);
  lib.contextEmbeddedTerminalCompose({ context, target, frame: null }, terminal, 0, 0);
  const original = lib.contextEmbeddedTerminalCursor(context, terminal);
  // Navigate only above the bottom: cancelling partial input at a full last row can scroll.
  if (original.y < size.rows - 1) {
    lib.contextEmbeddedTerminalWrite(context, terminal, `\x1b\\\x1b[?6l\x1b[r\x1b[${size.rows};1H`);
  }
  lib.contextEmbeddedTerminalCompose({ context, target, frame: null }, terminal, 0, 0);
  let previous = lib.contextEmbeddedTerminalCursor(context, terminal);
  let height = size.rows;
  let pulled = 0;
  let step = 32;
  const maximum = size.rows + PROJECTION_SCROLLBACK_LIMIT;
  while (height < maximum) {
    const growth = Math.min(
      step,
      maximum - height,
      Math.floor(PROJECTION_CELL_LIMIT / size.cols) - height,
    );
    if (growth < 1) {
      throw new Error("Cold-history native cell budget");
    }
    lib.contextEmbeddedTerminalResize(context, terminal, size.cols, height + growth);
    lib.contextResizeBuffer(context, target, size.cols, height + growth);
    lib.contextEmbeddedTerminalInvalidate(context, terminal);
    lib.contextEmbeddedTerminalCompose({ context, target, frame: null }, terminal, 0, 0);
    const next = lib.contextEmbeddedTerminalCursor(context, terminal);
    const added = next.y - previous.y;
    if (!original.hasValue || !next.hasValue || added < 0 || added > growth) {
      throw new Error("Cold-history native cursor discontinuity");
    }
    pulled += added;
    height += growth;
    previous = next;
    if (added < growth) {
      break;
    }
    step *= 2;
    await Bun.sleep(0);
  }
  return { rows: size.rows + pulled, cursor: { x: original.x, y: original.y + pulled } };
}

/** Snapshot public native cells only; the owner destroys this mutated parser afterward. */
export async function captureDisplayTranscript(
  lib: RenderLib,
  context: NativeContextHandle,
  terminal: ContextEmbeddedTerminalHandle,
  target: ContextBufferHandle,
  size: TerminalSize,
  placement: "after-content" | "preserve",
): Promise<Uint8Array> {
  let charged = 64;
  let resolvedBytes = 0;
  function charge(part: string): void {
    charged += Buffer.byteLength(part);
    if (charged > TRANSCRIPT_LIMIT) {
      throw new Error("Cold-history transcript byte budget");
    }
  }
  async function readRows(
    from: number,
    count: number,
  ): Promise<{ rows: string[]; lastMeaningful: number }> {
    const rows: string[] = [];
    let lastMeaningful = -1;
    for (let base = 0; base < count; base += 32) {
      const start = from + base;
      const height = Math.min(32, count - base);
      lib.contextResizeBuffer(context, target, size.cols, height);
      // A resized/reused target needs a full paint, not the previous composition's dirty rows.
      lib.contextEmbeddedTerminalInvalidate(context, terminal);
      lib.contextEmbeddedTerminalCompose({ context, target, frame: null }, terminal, 0, -start);
      const lease = lib.contextAcquireBufferLease(context, target);
      try {
        const cells = lease.width * lease.height;
        const count = lib.contextBufferLeaseGetRealCharSize(context, lease.handle, false);
        resolvedBytes += count;
        if (resolvedBytes > TRANSCRIPT_LIMIT) {
          throw new Error("Cold-history resolved character budget");
        }
        const bytes = new Uint8Array(count);
        const lengths = new Uint8Array(cells);
        lib.contextBufferLeaseWriteResolvedChars(context, lease.handle, bytes, false, lengths);
        const fg = new Uint16Array(toArrayBuffer(lease.fg, 0, cells * 8));
        const bg = new Uint16Array(toArrayBuffer(lease.bg, 0, cells * 8));
        const flags = new Uint32Array(toArrayBuffer(lease.attributes, 0, cells * 4));
        const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
        let offset = 0;
        let previous = -1;
        let style = { sgr: "", blank: false };
        for (let y = 0; y < height; y++) {
          const parts: string[] = [];
          let written: typeof style | undefined;
          let tail = false;
          for (let x = 0; x < size.cols; x++) {
            const index = y * size.cols + x;
            const length = lengths[index]!;
            if (length === 0) {
              if (!tail) {
                throw new Error("Invalid cold-history wide tail");
              }
              tail = false;
              continue;
            }
            if (tail) {
              throw new Error("Missing cold-history wide tail");
            }
            const width = x + 1 < size.cols && lengths[index + 1] === 0 ? 2 : 1;
            tail = width === 2;
            const value = decoder.decode(bytes.subarray(offset, offset + length));
            offset += length;
            drawable(value, width);
            let same = previous >= 0 && (flags[index]! & 255) === (flags[previous]! & 255);
            for (let channel = 0; channel < 4 && same; channel++) {
              same =
                fg[index * 4 + channel] === fg[previous * 4 + channel] &&
                bg[index * 4 + channel] === bg[previous * 4 + channel];
            }
            if (!same) {
              const foreground = RGBA.fromArray(fg.subarray(index * 4, index * 4 + 4));
              const background = RGBA.fromArray(bg.subarray(index * 4, index * 4 + 4));
              const bits = flags[index]! & 255;
              style = {
                sgr: `\x1b[${[0, ...attributes.filter(([bit]) => bits & bit).map(([, code]) => code), color(foreground, true), color(background, false)].join(";")}m`,
                blank:
                  bits === 0 &&
                  foreground.r === 1 &&
                  foreground.g === 1 &&
                  foreground.b === 1 &&
                  background.intent === "default",
              };
            }
            previous = index;
            if (value === " " && style.blank) {
              continue;
            }
            lastMeaningful = base + y;
            if (written !== style) {
              charge(style.sgr);
              parts.push(style.sgr);
              written = style;
            }
            const positioned = `\x1b[${x + 1}G${value}`;
            charge(positioned);
            parts.push(positioned);
          }
          charge("\x1b[0m\r\n");
          rows.push(parts.join(""));
        }
        if (offset !== bytes.byteLength) {
          throw new Error("Invalid cold-history resolved text lengths");
        }
      } finally {
        lib.contextReleaseBufferLease(context, lease.handle);
      }
      await Bun.sleep(0);
    }
    return { rows, lastMeaningful };
  }
  // Preserve the visible picture before trusted navigation cancels partial input or moves a cursor.
  const visible = await readRows(0, size.rows);
  const revealed = await revealHistory(lib, context, terminal, target, size);
  const preceding = revealed.rows - size.rows;
  const history = await readRows(0, preceding);
  const rows = [...history.rows, ...visible.rows];
  const lastMeaningful =
    visible.lastMeaningful >= 0 ? preceding + visible.lastMeaningful : history.lastMeaningful;
  const end =
    placement === "preserve" ? rows.length : Math.max(lastMeaningful, revealed.cursor.y) + 1;
  const suffix =
    placement === "preserve"
      ? `\x1b[0m\x1b[${revealed.cursor.y - (revealed.rows - size.rows) + 1};${revealed.cursor.x + 1}H`
      : "\x1b[0m\r\n";
  const result = new TextEncoder().encode(
    "\x1b[0m" + rows.slice(0, end).join("\x1b[0m\r\n") + suffix,
  );
  if (result.byteLength > TRANSCRIPT_LIMIT) {
    throw new Error("Cold-history transcript byte budget");
  }
  return result;
}
