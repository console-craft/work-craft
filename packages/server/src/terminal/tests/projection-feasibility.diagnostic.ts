import { expect, test } from "bun:test";

import { createProjectionFixture } from "./projection-fixture.ts";

test("OSC8 hyperlink cells expose a resolved URL rather than a native link ID", () => {
  const fixture = createProjectionFixture({ cols: 12, rows: 3 });
  try {
    fixture.write(new TextEncoder().encode("\x1b]8;;https://example.test/λ\x1b\\L\x1b]8;;\x1b\\"));
    expect(fixture.frame(0).rows[0]![0]).toMatchObject({
      text: "L",
      link: "https://example.test/λ",
    });
  } finally {
    fixture.destroy();
  }
});
