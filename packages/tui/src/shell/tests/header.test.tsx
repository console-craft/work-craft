import { expect, test } from "bun:test";

import { TextRenderable } from "@opentui/core";
import { act } from "react";

import { Header } from "@/shell/header.tsx";
import { testRender } from "@/shell/tests/fixtures";
import { icons } from "@/ui/icons/nerd";

test("header lays out workspace and session controls without manual widths", async () => {
  const setup = await testRender(
    <Header
      workspace={{
        activeId: "b",
        focused: false,
        workspaces: [
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
          { id: "c", name: "Gamma" },
          { id: "d", name: "Delta" },
        ],
        onActivate: () => {},
      }}
      session={{
        focused: false,
        name: "Work",
        status: "connecting",
        onOpen: () => {},
      }}
    />,
    { width: 50, height: 3 },
  );
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Alpha");
  expect(frame).toContain("Beta");
  expect(frame).toContain("Gamma");
  expect(frame).toContain("Delta");
  expect(frame).toContain("Work");
  const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
  const session = setup.renderer.root.findDescendantById("region:session")!;
  const indicator = setup.renderer.root.findDescendantById("connection-status")!;
  expect(session.screenY).toBe(workspace.screenY);
  expect(session.screenX).toBe(workspace.screenX + workspace.width);
  expect(session.height).toBe(3);
  expect(indicator.screenY).toBe(session.screenY + 1);
  expect(indicator.screenX).toBeGreaterThanOrEqual(session.screenX);
  expect(indicator.screenX + indicator.width).toBeLessThanOrEqual(session.screenX + session.width);
  act(() => setup.renderer.destroy());
});

test("header labels remain unabridged when the terminal narrows", async () => {
  const setup = await testRender(
    <Header
      workspace={{
        activeId: "a",
        focused: false,
        workspaces: [{ id: "a", name: "Workspace with a very long name" }],
        onActivate: () => {},
      }}
      session={{
        focused: false,
        name: "Session with a very long name",
        status: "connected",
        onOpen: () => {},
      }}
    />,
    { width: 120, height: 3 },
  );
  await setup.flush();
  const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
  const session = setup.renderer.root.findDescendantById("region:session")!;
  const indicator = setup.renderer.root.findDescendantById("connection-status")!;
  for (const width of [120, 30]) {
    act(() => setup.resize(width, 3));
    await setup.flush();
    expect(
      (workspace.findDescendantById("workspace:a")!.getChildren()[0] as TextRenderable).plainText,
    ).toBe(`${icons.number1CircleOutline} Workspace with a very long name`);
    expect((session.getChildren()[1] as TextRenderable).plainText).toBe(
      "Session with a very long name",
    );
    expect(session.screenY).toBe(workspace.screenY);
    expect(indicator.screenY).toBe(session.screenY + 1);
  }
  act(() => setup.renderer.destroy());
});
