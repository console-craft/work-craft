import {
  type OptimizedBuffer,
  Renderable,
  type RenderContext,
  RGBA,
  StyledText,
  TextBuffer,
  TextBufferView,
} from "@opentui/core";

// oxlint-disable-next-line no-restricted-imports -- Test-only plain projection DTO; no server/native value import.
import type { MaterialFrame } from "../../../../../scripts/test-support/terminal-projection-types";

export class MaterialProjection extends Renderable {
  private readonly texts: TextBuffer[] = [];
  private readonly views: TextBufferView[] = [];

  constructor(
    context: RenderContext,
    private readonly frame: MaterialFrame,
  ) {
    super(context, { id: "material-projection", width: frame.size.cols, height: frame.size.rows });
    try {
      for (const row of frame.rows) {
        const text = TextBuffer.create("unicode", context.nativeScene);
        this.texts.push(text);
        text.setStyledText(
          new StyledText(
            row
              .filter((cell) => cell.width !== 0)
              .map((cell) => ({
                __isChunk: true,
                text: cell.text,
                fg: RGBA.fromValues(...cell.fg),
                bg: RGBA.fromValues(...cell.bg),
                attributes: cell.attributes,
                link: cell.link ? { url: cell.link } : undefined,
              })),
          ),
        );
        const view = TextBufferView.create(text);
        this.views.push(view);
        view.setWrapMode("none");
        view.setViewportSize(frame.size.cols, 1);
      }
    } catch (error) {
      this.destroy();
      throw error;
    }
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

  protected destroySelf(): void {
    for (const view of this.views.splice(0)) {
      view.destroy();
    }
    for (const text of this.texts.splice(0)) {
      text.destroy();
    }
    super.destroySelf();
  }
}
