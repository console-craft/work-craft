import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { getLinkId } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import { MaterialProjection } from "@/workbench/tests/material-projection";

// oxlint-disable-next-line no-restricted-imports -- Test-only plain projection DTO; no server/native value import.
import type { MaterialFrame } from "../../../../../scripts/test-support/terminal-projection-types";

test("OSC8 destination URLs survive JSON into separately owned native drawing cells", async () => {
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
});
