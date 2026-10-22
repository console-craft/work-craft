import {
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
  type PasteEvent,
  Renderable,
  RenderableEvents,
  type RenderableOptions,
  type RenderContext,
  RGBA,
} from "@opentui/core";

import { semanticKey as semanticTerminalKey } from "@/workbench/tests/no-fork-input";

// oxlint-disable-next-line no-restricted-imports -- The positioned drawing trial is test-only.
import { validateCompactFrame } from "../../../../../scripts/test-support/terminal-projection-codec";
// oxlint-disable-next-line no-restricted-imports -- Portable experiment values, never native handles.
import type {
  CompactMaterialFrame,
  SemanticInput as SemanticTerminalInput,
} from "../../../../../scripts/test-support/terminal-projection-types";

export type TerminalMaterialOptions = RenderableOptions & {
  frame: CompactMaterialFrame;
  onInput?(input: SemanticTerminalInput): void;
  canInput?(): boolean;
};

/** Rejected drawing trial: positions survive, but public text drawing narrows regional indicators. */
export class TerminalMaterialRenderable extends Renderable {
  private frame: CompactMaterialFrame;
  private readonly send?: TerminalMaterialOptions["onInput"];
  private readonly canInput: () => boolean;
  private anchor?: { x: number; y: number };
  private end?: { x: number; y: number };
  scrollOffset = 0;
  private readonly release = (event: KeyEvent): void => {
    if (this.focused && !this.isDestroyed) {
      this.handleKeyPress(event);
    }
  };

  constructor(context: RenderContext, options: TerminalMaterialOptions) {
    const { frame, onInput, canInput, ...layout } = options;
    super(context, { ...layout, width: frame.size.cols, height: frame.size.rows });
    this.frame = validateCompactFrame(frame);
    this.send = onInput;
    this.canInput = canInput ?? (() => true);
    this.focusable = true;
    context.keyInput.on("keyrelease", this.release);
    this.on(RenderableEvents.FOCUSED, () => this.forward({ kind: "focus", focused: true }));
    this.on(RenderableEvents.BLURRED, () => {
      this.ctx.setCursorPosition(0, 0, false);
      this.forward({ kind: "focus", focused: false });
    });
  }

  setFrame(frame: CompactMaterialFrame): void {
    if (this.isDestroyed) {
      return;
    }
    validateCompactFrame(frame);
    this.frame = frame;
    this.width = frame.size.cols;
    this.height = frame.size.rows;
    this.requestRender();
  }

  private forward(input: SemanticTerminalInput): void {
    if (!this.isDestroyed && this.canInput()) {
      this.send?.(input);
    }
  }

  handleKeyPress(event: KeyEvent): boolean {
    if (!this.canInput()) {
      return false;
    }
    this.forward(semanticTerminalKey(event));
    return true;
  }

  handlePaste(event: PasteEvent): void {
    if (this.canInput()) {
      this.forward({ kind: "paste", bytes: [...event.bytes] });
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    if (!this.canInput()) {
      return;
    }
    const button =
      event.type === "scroll"
        ? event.scroll?.direction === "up"
          ? "four"
          : "five"
        : ((["left", "middle", "right", "unknown", "four", "five", "six", "seven"] as const)[
            event.button
          ] ?? "unknown");
    const count =
      event.type === "scroll" ? Math.max(1, Math.ceil(Math.abs(event.scroll?.delta ?? 1))) : 1;
    if (!Number.isSafeInteger(count) || count > 65536) {
      throw new Error("Pointer event limit");
    }
    for (let index = 0; index < count; index++) {
      this.forward({
        kind: "mouse",
        mouse: {
          action:
            event.type === "down" || event.type === "scroll"
              ? "press"
              : event.type === "up"
                ? "release"
                : "motion",
          button,
          x: event.x - this.screenX,
          y: event.y - this.screenY,
          mods:
            (event.modifiers.shift ? 1 : 0) |
            (event.modifiers.ctrl ? 2 : 0) |
            (event.modifiers.alt ? 4 : 0),
          anyButtonPressed: event.isDragging === true,
        },
      });
    }
  }

  applyMouseResult(input: SemanticTerminalInput, forwarded: boolean): void {
    if (this.isDestroyed || forwarded || input.kind !== "mouse") {
      return;
    }
    const mouse = input.mouse;
    if (mouse.action === "press" && (mouse.button === "four" || mouse.button === "five")) {
      this.scrollOffset = Math.max(0, this.scrollOffset + (mouse.button === "four" ? 1 : -1));
      return;
    }
    if (mouse.button !== "left") {
      return;
    }
    const point = {
      x: Math.max(0, Math.min(this.frame.size.cols - 1, Math.floor(mouse.x))),
      y: Math.max(0, Math.min(this.frame.size.rows - 1, Math.floor(mouse.y))),
    };
    if (mouse.action === "press") {
      this.anchor = point;
    }
    if (this.anchor) {
      this.end = point;
      this.requestRender();
    }
  }

  private selected(x: number, y: number, width = 1): boolean {
    if (!this.anchor || !this.end) {
      return false;
    }
    const a = this.anchor.y * this.frame.size.cols + this.anchor.x;
    const b = this.end.y * this.frame.size.cols + this.end.x;
    const value = y * this.frame.size.cols + x;
    return value <= Math.max(a, b) && value + width - 1 >= Math.min(a, b);
  }

  getSelectedText(): string {
    if (!this.anchor || !this.end) {
      return "";
    }
    const result: string[] = [];
    for (
      let y = Math.min(this.anchor.y, this.end.y);
      y <= Math.max(this.anchor.y, this.end.y);
      y++
    ) {
      let x = 0;
      let text = "";
      for (const [count, value, width] of this.frame.rows[y] ?? []) {
        for (let i = 0; i < count; i++) {
          if (width && this.selected(x + i, y, width)) {
            text += value;
          }
        }
        x += count;
      }
      result.push(text);
    }
    return result.join("\n");
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const styles = this.frame.styles.map((style) => ({
      ...style,
      fg: RGBA.fromValues(...style.fg),
      bg: RGBA.fromValues(...style.bg),
    }));
    for (const [y, row] of this.frame.rows.entries()) {
      let x = 0;
      for (const [count, , , style] of row) {
        buffer.fillRect(x, y, count, 1, styles[style]!.bg);
        x += count;
      }
      x = 0;
      for (const [count, text, width, index] of row) {
        const style = styles[index]!;
        if (width) {
          for (let i = 0; i < count; i++) {
            const selected = this.selected(x + i, y, width);
            const bg = selected ? RGBA.fromInts(180, 200, 255) : style.bg;
            const fg = selected ? RGBA.fromInts(0, 0, 0) : style.fg;
            if (selected) {
              buffer.fillRect(x + i, y, width, 1, bg);
            }
            buffer.drawText(text, x + i, y, fg, bg, style.attributes);
          }
        }
        x += count;
      }
    }
    if (this.focused) {
      const cursor = this.frame.cursor;
      const x = this.screenX + cursor.x,
        y = this.screenY + cursor.y;
      let visible = cursor.visible && cursor.x < this.width && cursor.y < this.height;
      for (let node = this.parent; node; node = node.parent) {
        if (
          !node.visible ||
          (node.overflow !== "visible" &&
            (x < node.screenX ||
              y < node.screenY ||
              x >= node.screenX + node.width ||
              y >= node.screenY + node.height))
        ) {
          visible = false;
        }
      }
      this.ctx.setCursorPosition(Math.max(0, x + 1), Math.max(0, y + 1), visible);
      this.ctx.setCursorStyle({
        style:
          cursor.style === "bar" ? "line" : cursor.style === "underline" ? "underline" : "block",
        blinking: cursor.blinking,
      });
    }
  }

  protected destroySelf(): void {
    this.ctx.keyInput.off("keyrelease", this.release);
    super.destroySelf();
  }
}
