import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  getLinkId,
  type OptimizedBuffer,
  Renderable,
  type RenderContext,
  RGBA,
  StyledText,
  TextBuffer,
  TextBufferView,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

// oxlint-disable-next-line no-restricted-imports -- Test-only plain projection DTO; no server/native value import.
import type { MaterialFrame } from "../../../../../scripts/test-support/terminal-projection-types";

class MaterialProjection extends Renderable {
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

test("resolved Unicode material survives JSON into a different native drawing context", async () => {
  const fixturePath = resolve(
    import.meta.dir,
    "../../../../server/src/terminal/tests/projection-fixture.ts",
  );
  const child = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `
    import { createProjectionFixture } from ${JSON.stringify(fixturePath)};
    const fixture = createProjectionFixture({ cols: 12, rows: 3 });
    try {
      fixture.write(new TextEncoder().encode("λ🙂e\\u0301\\x1b[1;3;4;38;2;17;34;51;48;2;68;85;102m \\x1b[6 q"));
      console.log(JSON.stringify(fixture.frame(0)));
    } finally { fixture.destroy(); }
    process.exit(0);
  `,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({
    code: 0,
    stderr: "",
  });
  const frame: MaterialFrame = JSON.parse(child.stdout.toString());
  const setup = await createTestRenderer({ width: 12, height: 3, exitOnCtrlC: false });
  try {
    setup.renderer.root.add(new MaterialProjection(setup.renderer, frame));
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("λ🙂e\u0301");
    expect(setup.renderer.getCursorState()).toMatchObject({
      x: 6,
      y: 1,
      visible: true,
      style: "line",
      blinking: false,
    });
    const styled = setup.captureSpans().lines[0]!.spans.find((span) => span.attributes === 13)!;
    expect(styled.text).toBe(" ");
    expect(styled.fg.toInts()).toEqual([17, 34, 51, 255]);
    expect(styled.bg.toInts()).toEqual([68, 85, 102, 255]);
  } finally {
    setup.renderer.destroy();
  }
});

const hyperlinkTest = process.env.WORK_CRAFT_FORK_LINK_DIAGNOSTICS === "1" ? test : test.skip;
hyperlinkTest(
  "OSC8 destination URLs survive JSON into separately owned native drawing cells",
  async () => {
    const fixturePath = resolve(
      import.meta.dir,
      "../../../../server/src/terminal/tests/projection-fixture.ts",
    );
    const child = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
    import { createProjectionFixture } from ${JSON.stringify(fixturePath)};
    const fixture = createProjectionFixture({ cols: 12, rows: 3 });
    try {
      fixture.write(new TextEncoder().encode("\\x1b]8;;https://example.test/λ\\x1b\\\\L\\x1b]8;;\\x1b\\\\"));
      console.log(JSON.stringify(fixture.frame(0)));
    } finally { fixture.destroy(); }
    process.exit(0);
  `,
      ],
      { stderr: "pipe", stdout: "pipe" },
    );
    expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({
      code: 0,
      stderr: "",
    });
    const frame: MaterialFrame = JSON.parse(child.stdout.toString());
    expect(frame.rows[0]![0]).toMatchObject({ text: "L", link: "https://example.test/λ" });
    const setup = await createTestRenderer({ width: 12, height: 3, exitOnCtrlC: false });
    try {
      const projection = new MaterialProjection(setup.renderer, frame);
      setup.renderer.root.add(projection);
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("L");
      const owner = setup.renderer.nativeScene.resourceContext;
      const id = setup.renderer.currentRenderBuffer.withBuffers(({ attributes }) =>
        getLinkId(attributes[0]!),
      );
      expect(id).not.toBe(0);
      expect(owner.renderLib.contextGetLinkUrl(owner.context, id)).toBe("https://example.test/λ");
      projection.destroy();
      const plain = structuredClone(frame);
      plain.rows[0]![0] = { ...plain.rows[0]![0]!, text: "N", link: undefined };
      setup.renderer.root.add(new MaterialProjection(setup.renderer, plain));
      await setup.flush();
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("N");
      setup.renderer.currentRenderBuffer.withBuffers(({ attributes }) => {
        expect(getLinkId(attributes[0]!)).toBe(0);
      });
      expect(() => owner.renderLib.contextGetLinkUrl(owner.context, id)).toThrow();
    } finally {
      setup.renderer.destroy();
    }
  },
);
