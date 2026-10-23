import {
  convertGlobalToLocalSelection,
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
  type PasteEvent,
  Renderable,
  RenderableEvents,
  type RenderableOptions,
  type RenderContext,
  RGBA,
  type Selection,
} from "@opentui/core";
import {
  type CompactMaterialFrame,
  type SemanticTerminalInput,
  validateCompactFrame,
} from "@work-craft/server/client";

import { semanticTerminalKey } from "@/workbench/terminal-semantic-input";

export type TerminalMaterialOptions = RenderableOptions & {
  /** Initial picture; live updates use setFrame, independently of React prop commits. */
  frame: CompactMaterialFrame;
  onInput?(input: SemanticTerminalInput): void;
  canInput?(): boolean;
  canBrowse?(): boolean;
  onScroll?(lines: number): void;
};

/** Preview picture, not an ANSI parser. Single regional indicators remain visibly narrow. */
export class TerminalMaterialRenderable extends Renderable {
  private picture: CompactMaterialFrame;
  private renderedFrame?: CompactMaterialFrame;
  private readonly send?: TerminalMaterialOptions["onInput"];
  private readonly canInput: () => boolean;
  private readonly canBrowse?: () => boolean;
  private readonly onScroll?: (lines: number) => void;
  private anchor?: { x: number; y: number };
  private end?: { x: number; y: number };
  private selecting = false;
  scrollOffset = 0;
  private readonly release = (event: KeyEvent): void => {
    if (this.focused && !this.isDestroyed) {
      this.handleKeyPress(event);
    }
  };

  constructor(context: RenderContext, options: TerminalMaterialOptions) {
    const { frame, onInput, canInput, canBrowse, onScroll, ...layout } = options;
    validateCompactFrame(frame);
    super(context, { ...layout, width: frame.size.cols, height: frame.size.rows });
    this.picture = frame;
    this.send = onInput;
    this.canInput = canInput ?? (() => true);
    this.canBrowse = canBrowse;
    this.onScroll = onScroll;
    this.focusable = true;
    this.selectable = true;
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
    this.picture = frame;
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
      this.forward({ kind: "paste", bytes: Uint8Array.from(event.bytes) });
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    if (!this.isDestroyed && event.type === "scroll" && this.onScroll && this.canBrowse?.()) {
      if (event.scroll?.direction === "up" || event.scroll?.direction === "down") {
        const count = Math.max(1, Math.ceil(Math.abs(event.scroll.delta ?? 1)));
        if (!Number.isSafeInteger(count) || count > 65536) {
          throw new Error("Pointer event limit");
        }
        this.onScroll(count * (event.scroll.direction === "up" ? 1 : -1));
      }
      return;
    }
    if (!this.canInput() || !["down", "up", "move", "drag", "scroll"].includes(event.type)) {
      return;
    }
    const button =
      event.type === "scroll"
        ? event.scroll?.direction === "up"
          ? "four"
          : "five"
        : event.type === "move" && !event.isDragging
          ? undefined
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
          anyButtonPressed:
            event.isDragging === true || event.type === "drag" || event.type === "down",
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
    const x = this.screenX + mouse.x;
    const y = this.screenY + mouse.y;
    if (mouse.action === "press") {
      this.ctx.startSelection(this, x, y);
    } else if (this.selecting || (mouse.action === "release" && this.hasSelection())) {
      this.ctx.updateSelection(this, x, y, { finishDragging: mouse.action === "release" });
    }
  }

  shouldStartSelection(): boolean {
    // The daemon decides whether the child consumed the press before local selection starts.
    return false;
  }

  onSelectionChanged(selection: Selection | null): boolean {
    const local = convertGlobalToLocalSelection(selection, this.screenX, this.screenY);
    this.selecting = selection?.isDragging === true;
    if (local?.isActive) {
      const point = (x: number, y: number) => ({
        x: Math.max(0, Math.min(this.picture.size.cols - 1, Math.floor(x))),
        y: Math.max(0, Math.min(this.picture.size.rows - 1, Math.floor(y))),
      });
      this.anchor = point(local.anchorX, local.anchorY);
      this.end = point(local.focusX, local.focusY);
    } else {
      this.anchor = undefined;
      this.end = undefined;
    }
    this.requestRender();
    return this.hasSelection();
  }

  hasSelection(): boolean {
    return this.anchor !== undefined && this.end !== undefined;
  }

  private selected(x: number, y: number, width = 1): boolean {
    if (!this.anchor || !this.end) {
      return false;
    }
    const a = this.anchor.y * this.picture.size.cols + this.anchor.x;
    const b = this.end.y * this.picture.size.cols + this.end.x;
    const value = y * this.picture.size.cols + x;
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
      for (const [count, value, width] of this.picture.rows[y] ?? []) {
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
    this.renderedFrame = this.picture;
    const styles = this.picture.styles.map((style) => ({
      ...style,
      fg: RGBA.fromValues(...style.fg),
      bg: RGBA.fromValues(...style.bg),
    }));
    for (const [y, row] of this.picture.rows.entries()) {
      let x = 0;
      for (const [count, , , style] of row) {
        buffer.fillRect(this.screenX + x, this.screenY + y, count, 1, styles[style]!.bg);
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
              buffer.fillRect(this.screenX + x + i, this.screenY + y, width, 1, bg);
            }
            buffer.drawText(text, this.screenX + x + i, this.screenY + y, fg, bg, style.attributes);
          }
        }
        x += count;
      }
    }
    if (this.focused) {
      const cursor = this.picture.cursor;
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

  /** Checked at the renderer's post-presentation FRAME event, never merely on receipt. */
  hasRendered(frame: CompactMaterialFrame): boolean {
    return !this.isDestroyed && this.renderedFrame === frame;
  }

  protected destroySelf(): void {
    this.ctx.keyInput.off("keyrelease", this.release);
    super.destroySelf();
  }
}
