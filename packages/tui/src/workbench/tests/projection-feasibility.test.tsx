import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { createTestRenderer } from "@opentui/core/testing";

import { MaterialProjection } from "@/workbench/tests/material-projection";

// oxlint-disable-next-line no-restricted-imports -- Test-only plain projection DTO; no server/native value import.
import type { MaterialFrame } from "../../../../../scripts/test-support/terminal-projection-types";

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
