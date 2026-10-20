import { expect, test } from "bun:test";

import type { InputRenderable } from "@opentui/core";
import type { Snapshot } from "@work-craft/server/client";
import { act } from "react";

import { SessionChooser } from "@/shell/session-chooser";
import { testRender } from "@/tests/support/render";
import { Dialog, DialogContent } from "@/ui/components/dialog";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

async function renderChooser(sessions: Snapshot["sessions"], selected: string[]) {
  return testRender(
    <ThemeProvider theme={defaultTheme}>
      <Dialog defaultOpen>
        <DialogContent initialFocusId={sessions.length === 0 ? "session:create" : "session:search"}>
          <SessionChooser
            sessions={sessions}
            canCancel={false}
            onSelect={(id) => selected.push(id)}
            onCreate={() => selected.push("create")}
          />
        </DialogContent>
      </Dialog>
    </ThemeProvider>,
    { width: 80, height: 25, kittyKeyboard: true, exitOnCtrlC: false },
  );
}

test("session command filters locally, clears with Ctrl+C, and activates only its match", async () => {
  const selected: string[] = [];
  const setup = await renderChooser(
    [
      { id: "first", name: "Work", position: 0 },
      { id: "second", name: "Planning", position: 1 },
    ],
    selected,
  );
  try {
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
    const input = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    await act(async () => setup.mockInput.typeText("njk"));
    await act(async () => setup.flush());
    expect(input.value).toBe("njk");
    expect(setup.captureCharFrame()).toContain("No matching sessions.");
    await act(async () => setup.mockInput.pressEnter());
    expect(selected).toEqual([]);
    await act(async () => setup.mockInput.pressCtrlC());
    await act(async () => setup.flush());
    expect(input.value).toBe("");
    expect(setup.captureCharFrame()).toContain("Work");
    await act(async () => setup.mockInput.pressKeys(["Planning\r"]));
    await act(async () => setup.flush());
    expect(selected).toEqual(["second"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("session chooser puts the search below its results and initially attaches the nearest row", async () => {
  const selected: string[] = [];
  const setup = await renderChooser(
    [
      { id: "first", name: "Work", position: 0 },
      { id: "second", name: "Personal", position: 1 },
    ],
    selected,
  );
  try {
    await act(async () => setup.flush());
    const query = setup.renderer.root.findDescendantById("session:search")!;
    const row = setup.renderer.root.findDescendantById("session:item:second")!;
    expect(query.screenY).toBeGreaterThanOrEqual(row.screenY + row.height);
    await act(async () => setup.mockInput.pressEnter());
    expect(selected).toEqual(["second"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("duplicate session labels activate their stable IDs and creation stays outside filtering", async () => {
  const selected: string[] = [];
  const setup = await renderChooser(
    [
      { id: "first", name: "Same", position: 0 },
      { id: "second", name: "Same", position: 1 },
    ],
    selected,
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKey("n", { ctrl: true }));
    await act(async () => setup.mockInput.pressEnter());
    expect(selected).toEqual(["second", "first"]);
    await act(async () => setup.mockInput.typeText("missing"));
    await act(async () => setup.flush());
    const create = setup.renderer.root.findDescendantById("session:create")!;
    expect(create.visible).toBe(true);
    act(() => create.focus());
    await act(async () => setup.mockInput.pressEnter());
    expect(selected).toEqual(["second", "first", "create"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("empty session command focuses creation and displays its empty state", async () => {
  const selected: string[] = [];
  const setup = await renderChooser([], selected);
  try {
    await act(async () => setup.flush());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    expect(setup.captureCharFrame()).toContain("No sessions yet.");
    await act(async () => setup.mockInput.pressEnter());
    expect(selected).toEqual(["create"]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});
