import {
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
  type PasteEvent,
  Renderable,
  RenderableEvents,
  type RenderContext,
  RGBA,
  StyledText,
  TextBuffer,
  TextBufferView,
} from "@opentui/core";

import { semanticKey } from "@/workbench/tests/no-fork-input";
import { sameProjectionStamp } from "@/workbench/tests/no-fork-input-queue";

// oxlint-disable-next-line no-restricted-imports -- Test-only bounded material validation.
import { validateCompactFrame } from "../../../../../scripts/test-support/terminal-projection-codec";
// oxlint-disable-next-line no-restricted-imports -- Test-only plain material DTO.
import type {
  CompactMaterialFrame,
  ProjectionEnvelope,
  ProjectionStamp,
  SemanticInput,
} from "../../../../../scripts/test-support/terminal-projection-types";

export class NoForkMaterialView extends Renderable {
  private sequence = -1;
  private publisher?: { epoch: string; runtime: string };
  setEnvelope(envelope: ProjectionEnvelope, current: ProjectionStamp): boolean {
    if (this.isDestroyed) {
      return false;
    }
    const samePublisher =
      this.publisher?.epoch === envelope.stamp.epoch &&
      this.publisher?.runtime === envelope.stamp.runtime;
    if (
      !sameProjectionStamp(envelope.stamp, current) ||
      (samePublisher && envelope.sequence <= this.sequence)
    ) {
      return false;
    }
    this.setFrame(envelope.frame);
    this.sequence = envelope.sequence;
    this.publisher = { epoch: envelope.stamp.epoch, runtime: envelope.stamp.runtime };
    return true;
  }
  scrollOffset = 0;
  private anchor?: { x: number; y: number };

  applyMouseResult(input: SemanticInput, forwarded: boolean): void {
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
    if (mouse.action === "press") {
      this.anchor = { x: mouse.x, y: mouse.y };
      return;
    }
    if (!this.anchor) {
      return;
    }
    for (const [y, view] of this.views.entries()) {
      view.setLocalSelection(this.anchor.x, this.anchor.y - y, mouse.x, mouse.y - y);
    }
    this.requestRender();
  }

  getSelectedText(): string {
    return this.views
      .filter((view) => view.hasSelection())
      .map((view) => view.getSelectedText())
      .join("\n");
  }
  private readonly texts: TextBuffer[] = [];
  private readonly views: TextBufferView[] = [];
  private frame: CompactMaterialFrame;

  private readonly release = (event: KeyEvent): void => {
    if (this.focused && !this.isDestroyed) {
      this.handleKeyPress(event);
    }
  };

  constructor(
    context: RenderContext,
    frame: CompactMaterialFrame,
    private readonly send?: (event: SemanticInput) => void,
    private readonly canSend: () => boolean = () => true,
  ) {
    super(context, { width: frame.size.cols, height: frame.size.rows });
    this.frame = frame;
    this.focusable = true;
    context.keyInput.on("keyrelease", this.release);
    this.on(RenderableEvents.FOCUSED, () => {
      if (this.canSend()) {
        this.send?.({ kind: "focus", focused: true });
      }
    });
    this.on(RenderableEvents.BLURRED, () => {
      if (this.canSend()) {
        this.send?.({ kind: "focus", focused: false });
      }
    });
    try {
      this.setFrame(frame);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  handleKeyPress(event: KeyEvent): boolean {
    if (!this.canSend()) {
      return false;
    }
    this.send?.(semanticKey(event));
    return true;
  }

  handlePaste(event: PasteEvent): void {
    if (!this.canSend()) {
      return;
    }
    this.send?.({ kind: "paste", bytes: [...event.bytes] });
  }

  protected onMouseEvent(event: MouseEvent): void {
    if (!this.canSend()) {
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
    if (!Number.isSafeInteger(count) || count > (8 * 1024 * 1024) / 128) {
      throw new Error("Pointer event limit");
    }
    for (let index = 0; index < count; index++) {
      this.send?.({
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

  setFrame(frame: CompactMaterialFrame): void {
    if (this.isDestroyed) {
      return;
    }
    validateCompactFrame(frame);
    const texts: TextBuffer[] = [];
    const views: TextBufferView[] = [];
    try {
      for (const row of frame.rows) {
        const text = TextBuffer.create("unicode", this.ctx.nativeScene);
        texts.push(text);
        text.setStyledText(
          new StyledText(
            row
              .filter(([, , width]) => width !== 0)
              .map(([count, value, , style]) => ({
                __isChunk: true,
                text: value.repeat(count),
                fg: RGBA.fromValues(...frame.styles[style]!.fg),
                bg: RGBA.fromValues(...frame.styles[style]!.bg),
                attributes: frame.styles[style]!.attributes,
              })),
          ),
        );
        const view = TextBufferView.create(text);
        views.push(view);
        view.setWrapMode("none");
        view.setViewportSize(frame.size.cols, 1);
      }
    } catch (error) {
      for (const view of views) {
        view.destroy();
      }
      for (const text of texts) {
        text.destroy();
      }
      throw error;
    }
    this.clearRows();
    this.texts.push(...texts);
    this.views.push(...views);
    this.frame = frame;
    this.width = frame.size.cols;
    this.height = frame.size.rows;
    this.requestRender();
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    for (const [y, view] of this.views.entries()) {
      buffer.drawTextBuffer(view, 0, y);
    }
    const cursor = this.frame.cursor;
    this.ctx.setCursorPosition(cursor.x + 1, cursor.y + 1, cursor.visible);
    this.ctx.setCursorStyle({
      style: cursor.style === "bar" ? "line" : cursor.style === "underline" ? "underline" : "block",
      blinking: cursor.blinking,
    });
  }

  private clearRows(): void {
    for (const view of this.views.splice(0)) {
      view.destroy();
    }
    for (const text of this.texts.splice(0)) {
      text.destroy();
    }
  }

  protected destroySelf(): void {
    this.ctx.keyInput.off("keyrelease", this.release);
    this.clearRows();
    super.destroySelf();
  }
}
