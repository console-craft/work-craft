import { toArrayBuffer } from "bun:ffi";

import { getLinkId, resolveRenderLib, RGBA } from "@opentui/core";

import type {
  MaterialCell,
  MaterialFrame,
  SemanticInput,
} from "../../../../../scripts/test-support/terminal-projection-types.ts";

type ProjectionFixture = {
  write(bytes: Uint8Array): void;
  resize(size: MaterialFrame["size"]): void;
  frame(scrollOffset: number): MaterialFrame;
  encode(event: SemanticInput): Uint8Array;
  encodePaste(bytes: Uint8Array): Uint8Array;
  replies(): Uint8Array;
  destroy(): void;
};

/** Test-owned parser and material extraction using only checked public native APIs. */
export function createProjectionFixture(
  initialSize: MaterialFrame["size"],
  renderCellsMax = Math.max(2000, initialSize.cols * initialSize.rows * 2),
): ProjectionFixture {
  const lib = resolveRenderLib();
  const context = lib.createContext({
    objectCapacity: 32,
    renderCellsMax,
  });
  let terminal: ReturnType<typeof lib.createContextEmbeddedTerminal> | undefined;
  let target: ReturnType<typeof lib.createContextBuffer> | undefined;
  let closed = false;
  let size = { ...initialSize };

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
    target = lib.createContextBuffer(context, { width: size.cols, height: size.rows });
  } catch (error) {
    destroy();
    throw error;
  }

  function frame(scrollOffset: number): MaterialFrame {
    if (!Number.isSafeInteger(scrollOffset) || scrollOffset < 0) {
      throw new RangeError("Scroll offset must be a nonnegative integer");
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
        const fg = new Uint16Array(toArrayBuffer(lease.fg, 0, cells * 4 * 2));
        const bg = new Uint16Array(toArrayBuffer(lease.bg, 0, cells * 4 * 2));
        const attributes = new Uint32Array(toArrayBuffer(lease.attributes, 0, cells * 4));
        const bytes = new Uint8Array(
          lib.contextBufferLeaseGetRealCharSize(context, lease.handle, false),
        );
        const lengths = new Uint8Array(cells);
        lib.contextBufferLeaseWriteResolvedChars(context, lease.handle, bytes, false, lengths);
        const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
        let offset = 0;
        function color(plane: Uint16Array, index: number): MaterialCell["fg"] {
          const rgba = RGBA.fromArray(plane.subarray(index * 4, index * 4 + 4));
          return [rgba.r, rgba.g, rgba.b, rgba.a];
        }
        const rows: MaterialCell[][] = [];
        for (let y = 0; y < lease.height; y++) {
          const row: MaterialCell[] = [];
          for (let x = 0; x < lease.width; x++) {
            const index = y * lease.width + x;
            const length = lengths[index]!;
            const text = decoder.decode(bytes.subarray(offset, offset + length));
            offset += length;
            const linkId = getLinkId(attributes[index]!);
            row.push({
              text,
              width: length === 0 ? 0 : x + 1 < lease.width && lengths[index + 1] === 0 ? 2 : 1,
              fg: color(fg, index),
              bg: color(bg, index),
              attributes: attributes[index]! & 255,
              ...(linkId ? { link: lib.contextGetLinkUrl(context, linkId) } : {}),
            });
          }
          rows.push(row);
        }
        return {
          size: { ...size },
          rows,
          cursor: {
            x: cursor.x,
            y: cursor.y,
            visible: cursor.hasValue && cursor.visible,
            style: cursor.style,
            blinking: cursor.blinking,
          },
        };
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
    write: (bytes) => lib.contextEmbeddedTerminalWrite(context, terminal!, bytes),
    resize(next) {
      lib.contextEmbeddedTerminalResize(context, terminal!, next.cols, next.rows);
      lib.contextResizeBuffer(context, target!, next.cols, next.rows);
      size = { ...next };
    },
    replies: () => lib.contextEmbeddedTerminalDrainResponses(context, terminal!),
    encodePaste: (bytes) => lib.contextEmbeddedTerminalEncodePaste(context, terminal!, bytes),
    encode(event) {
      switch (event.kind) {
        case "key":
          return lib.contextEmbeddedTerminalEncodeKey(context, terminal!, event.key);
        case "mouse":
          return lib.contextEmbeddedTerminalEncodeMouse(context, terminal!, event.mouse);
        case "paste":
          return lib.contextEmbeddedTerminalEncodePaste(
            context,
            terminal!,
            new Uint8Array(event.bytes),
          );
        case "focus":
          return lib.contextEmbeddedTerminalEncodeFocus(context, terminal!, event.focused);
      }
    },
  };
}
