import { toArrayBuffer } from "bun:ffi";

import { resolveRenderLib, RGBA } from "@opentui/core";

import type { TerminalSize } from "../api/protocol";
import type {
  CompactMaterialFrame,
  MaterialCell,
  SemanticTerminalInput,
} from "../api/terminal-material";
import { createCompactFrameBuilder } from "../api/terminal-material-codec";

export type TerminalProjection = {
  write(bytes: Uint8Array): void;
  resize(size: TerminalSize): void;
  frame(scrollOffset: number): CompactMaterialFrame;
  encode(input: SemanticTerminalInput): Uint8Array;
  encodePaste(bytes: Uint8Array): Uint8Array;
  replies(): Uint8Array;
  destroy(): void;
};

/** Owns checked public native resources; neither glyph IDs nor borrowed planes escape. */
export function createTerminalProjection(initialSize: TerminalSize): TerminalProjection {
  const lib = resolveRenderLib();
  const context = lib.createContext({ objectCapacity: 32, renderCellsMax: 2 * 1_048_576 });
  let terminal: ReturnType<typeof lib.createContextEmbeddedTerminal> | undefined;
  let target: ReturnType<typeof lib.createContextBuffer> | undefined;
  let size = { ...initialSize };
  let closed = false;
  function destroy(): void {
    if (closed) {
      return;
    }
    closed = true;
    try {
      if (target) {
        lib.destroyContextBuffer(context, target);
      }
    } finally {
      try {
        if (terminal) {
          lib.destroyContextEmbeddedTerminal(context, terminal);
        }
      } finally {
        lib.destroyContext(context);
      }
    }
  }
  try {
    terminal = lib.createContextEmbeddedTerminal(context, { ...size, maxScrollback: 10000 });
    lib.contextEmbeddedTerminalSetTransparentBackground(context, terminal, true);
    target = lib.createContextBuffer(context, { width: size.cols, height: size.rows });
  } catch (error) {
    destroy();
    throw error;
  }
  function frame(scrollOffset: number): CompactMaterialFrame {
    if (!Number.isSafeInteger(scrollOffset) || scrollOffset < 0) {
      throw new RangeError("Invalid scroll offset");
    }
    lib.contextEmbeddedTerminalScroll(context, terminal!, -scrollOffset);
    try {
      lib.contextEmbeddedTerminalCompose(
        { context, target: target!, frame: null },
        terminal!,
        0,
        0,
      );
      const cursor = lib.contextEmbeddedTerminalCursor(context, terminal!);
      const lease = lib.contextAcquireBufferLease(context, target!);
      try {
        const cells = lease.width * lease.height;
        const fg = new Uint16Array(toArrayBuffer(lease.fg, 0, cells * 8));
        const bg = new Uint16Array(toArrayBuffer(lease.bg, 0, cells * 8));
        const attributes = new Uint32Array(toArrayBuffer(lease.attributes, 0, cells * 4));
        const byteLength = lib.contextBufferLeaseGetRealCharSize(context, lease.handle, false);
        if (byteLength > 8 * 1024 * 1024) {
          throw new Error("Projection extraction character budget");
        }
        const bytes = new Uint8Array(byteLength);
        const lengths = new Uint8Array(cells);
        lib.contextBufferLeaseWriteResolvedChars(context, lease.handle, bytes, false, lengths);
        const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
        let offset = 0;
        const builder = createCompactFrameBuilder(size, {
          x: cursor.x,
          y: cursor.y,
          visible: cursor.hasValue && cursor.visible,
          style: cursor.style,
          blinking: cursor.blinking,
        });
        function color(plane: Uint16Array, index: number, background = false): MaterialCell["fg"] {
          const value = RGBA.fromArray(plane.subarray(index * 4, index * 4 + 4));
          // Default background follows the client theme; explicitly painted black stays opaque.
          return [
            value.r,
            value.g,
            value.b,
            background && value.intent === "default" ? 0 : value.a,
          ];
        }
        function* row(y: number): Generator<MaterialCell> {
          for (let x = 0; x < lease.width; x++) {
            const index = y * lease.width + x;
            const length = lengths[index]!;
            const text = decoder.decode(bytes.subarray(offset, offset + length));
            offset += length;
            yield {
              text,
              width: length === 0 ? 0 : x + 1 < lease.width && lengths[index + 1] === 0 ? 2 : 1,
              fg: color(fg, index),
              bg: color(bg, index, true),
              attributes: attributes[index]! & 255,
            };
          }
        }
        for (let y = 0; y < lease.height; y++) {
          builder.addRow(row(y));
        }
        return builder.finish();
      } finally {
        lib.contextReleaseBufferLease(context, lease.handle);
      }
    } finally {
      lib.contextEmbeddedTerminalScroll(context, terminal!, scrollOffset);
    }
  }
  return {
    destroy,
    frame,
    write(bytes) {
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        lib.contextEmbeddedTerminalWrite(context, terminal!, bytes.subarray(offset, offset + 8192));
      }
    },
    resize(next) {
      lib.contextEmbeddedTerminalResize(context, terminal!, next.cols, next.rows);
      lib.contextResizeBuffer(context, target!, next.cols, next.rows);
      size = { ...next };
    },
    replies() {
      const bytes = lib.contextEmbeddedTerminalDrainResponses(context, terminal!);
      const text = new TextDecoder().decode(bytes);
      // shortcut: native mode 2048 advertises reports it never emits; remove when native resize reports work.
      const reply = text
        .replaceAll("\x1b[?2048;2$y", "\x1b[?2048;0$y")
        .replaceAll("\x1b[?2048;1$y", "\x1b[?2048;0$y");
      return reply === text ? bytes : new TextEncoder().encode(reply);
    },
    encodePaste: (bytes) => lib.contextEmbeddedTerminalEncodePaste(context, terminal!, bytes),
    encode(input) {
      switch (input.kind) {
        case "key":
          return lib.contextEmbeddedTerminalEncodeKey(context, terminal!, input.key);
        case "mouse":
          return lib.contextEmbeddedTerminalEncodeMouse(context, terminal!, input.mouse);
        case "paste":
          return lib.contextEmbeddedTerminalEncodePaste(
            context,
            terminal!,
            new Uint8Array(input.bytes),
          );
        case "focus":
          return lib.contextEmbeddedTerminalEncodeFocus(context, terminal!, input.focused);
      }
    },
  };
}
