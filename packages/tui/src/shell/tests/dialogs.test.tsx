import { expect, test } from "bun:test";

import {
  BoxRenderable,
  InputRenderable,
  type MouseEvent,
  parseColor,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { type Command, type CommandResponse, type Snapshot } from "@work-craft/server/client";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { DialogOverlay } from "@/shell/dialog-overlay.tsx";
import { SessionChooser } from "@/shell/session-chooser.tsx";
import { WorkCraftShell } from "@/shell/shell.tsx";
import type { DialogState } from "@/shell/state";
import { StatusBar } from "@/shell/status-bar.tsx";
import {
  deferred,
  openFixtureItem,
  splitSurfaceSnapshot,
  statusText,
  surfaceSnapshot,
  testRender,
  twoSurfaceSnapshot,
  workCraftStateFixture,
} from "@/shell/tests/fixtures";
import { createScopeFixture, snapshotFixture, streamFixture } from "@/tests/support/fixtures.ts";
import { Dialog } from "@/ui/components/dialog";
import { icons } from "@/ui/icons/nerd";
import { getControlHints } from "@/ui/interaction/control-hints";
import { isEligibleFocusTarget } from "@/ui/interaction/focus-utils";
import { Box } from "@/ui/primitives/box.tsx";
import { Stack } from "@/ui/primitives/stack";
import { defaultTheme } from "@/ui/theming/themes/default.ts";

test("a dialog above narrow navigation retains dialog HINTS", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 80,
    height: 20,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await setup.flush();
    expect(statusText(setup)).toContain("HINTS");
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    expect(statusText(setup)).toContain("HINTS");
    expect(statusText(setup)).toContain(`${icons.return} Attach`);
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(statusText(setup)).toContain("HINTS");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const kind of [
  "sessions",
  "session",
  "workspace",
  "directory",
  "generic-root",
  "generic-child",
] as const) {
  test(`${kind} overlay leaves status hints uncovered across resize`, async () => {
    const dialog: Exclude<DialogState, null> =
      kind === "sessions"
        ? { kind, returnFocus: { region: "category" } }
        : {
            kind: "create",
            createKind: kind,
            scope: createScopeFixture(snapshotFixture()),
            returnFocus: { region: "category" },
          };
    let cancellations = 0;
    const setup = await testRender(
      <Stack width="100%" height="100%" gap={0}>
        <Box flexGrow={1} />
        <StatusBar mode="HINTS" hints={[{ keys: "Escape", label: "Cancel" }]} />
        <DialogOverlay
          dialog={dialog}
          canCancel
          sessions={snapshotFixture().sessions}
          promptValue=""
          error={null}
          onCreateSession={() => {}}
          onSelectSession={() => {}}
          onCancel={() => cancellations++}
          onPromptChange={() => {}}
          onPromptSubmit={() => {}}
        />
      </Stack>,
      { width: 120, height: 40, kittyKeyboard: true },
    );
    try {
      for (const height of [40, 20, 6, 2, 1]) {
        act(() => setup.resize(120, height));
        await setup.flush();
        const status = setup.renderer.root.findDescendantById("status")!;
        const content = setup.renderer.root.findDescendantById("dialog")!;
        const overlay = content.parent!;
        if (height === 1) {
          expect(overlay.visible).toBe(false);
        } else {
          expect(overlay.screenY + overlay.height).toBeLessThanOrEqual(status.screenY);
        }
        const statusLine = setup.captureSpans().lines[height - 1]!;
        const badge = statusLine.spans.find(({ text }) => text.includes("HINTS"));
        expect(badge).toBeDefined();
        expect(badge!.bg.toInts()).toEqual(parseColor(defaultTheme.colors.primary).toInts());
        expect(statusLine.spans.map(({ text }) => text).join("")).toContain("Cancel");
      }
      const focus = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockMouse.click(1, 0));
      await setup.flush();
      expect(cancellations).toBe(0);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(focus?.id);
      act(() => setup.resize(120, 20));
      await setup.flush();
      const restoredFocus = setup.renderer.currentFocusedRenderable;
      const content = setup.renderer.root.findDescendantById("dialog")!;
      expect(restoredFocus).not.toBeNull();
      expect(isEligibleFocusTarget(restoredFocus!, content)).toBe(true);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("modal button mouse-down updates focus, styling and hints before a cancelled release", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    const button = setup.renderer.root.findDescendantById("session:create") as BoxRenderable;
    const label = button.getChildren()[0] as TextRenderable;
    let mouseDown: MouseEvent | undefined;
    label.onMouseDown = (event) => {
      mouseDown = event;
    };
    const query = list.value;
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    await act(async () => setup.mockMouse.pressDown(label.screenX, label.screenY));
    await setup.flush();
    expect(mouseDown?.target).toBe(label);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    expect(mouseDown?.defaultPrevented).toBe(false);
    expect(button.focused).toBe(true);
    expect(list.focused).toBe(false);
    expect(button.backgroundColor.toInts()).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    expect(statusText(setup)).toContain(`${icons.return}/${icons.space} Activate`);
    expect(statusText(setup)).not.toContain(`${icons.return} Attach`);
    expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
    await act(async () => {
      await setup.mockMouse.moveTo(0, 0);
      await setup.mockMouse.release(0, 0);
      setup.mockInput.pressKey("j");
    });
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
    expect(list.value).toBe(query);
    expect(setup.renderer.root.findDescendantById("session:search")).toBe(list);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("modal list mouse-down takes focus back from its sibling without closing the fixture", async () => {
  const selected: string[] = [];
  let backgroundPresses = 0;
  const setup = await testRender(
    <Box onMouseDown={() => backgroundPresses++}>
      <DialogOverlay
        dialog={{ kind: "sessions", returnFocus: { region: "category" } }}
        canCancel={false}
        sessions={snapshotFixture().sessions}
        promptValue=""
        error={null}
        onCreateSession={() => {}}
        onCancel={() => {}}
        onSelectSession={(id) => selected.push(id)}
        onPromptChange={() => {}}
        onPromptSubmit={() => {}}
      />
    </Box>,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    const button = setup.renderer.root.findDescendantById("session:create") as BoxRenderable;
    act(() => button.focus());
    await setup.flush();
    expect(getControlHints(button)).toEqual([{ keys: "Enter/Space", label: "Activate" }]);
    const row = setup.renderer.root.findDescendantById("session:item:session-work")!;
    await act(async () => setup.mockMouse.pressDown(row.screenX + 1, row.screenY));
    await setup.flush();
    expect(selected).toEqual([]);
    expect(setup.renderer.root.findDescendantById("session:search")).toBe(list);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog");
    expect(list.focused).toBe(false);
    expect(button.focused).toBe(false);
    expect(button.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.primary).toInts(),
    );
    expect(getControlHints(list)).toEqual([]);
    expect(getControlHints(button)).toEqual([]);
    expect(backgroundPresses).toBe(0);
    await act(async () => setup.mockMouse.release(row.screenX + 1, row.screenY));
    expect(selected).toEqual(["session-work"]);
    act(() => list.focus());

    await act(async () => setup.mockMouse.click(0, 0));
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    expect(backgroundPresses).toBe(0);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("chooser and prompt keep every shell region mounted", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  const initial = setup.captureCharFrame();
  expect(initial).toContain("HINTS");
  expect(initial).toContain("IMPLEMENTATION");

  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();
  const chooser = setup.captureCharFrame();
  expect(chooser).toContain("Sessions");
  expect(chooser).toContain("HINTS");
  const dialog = setup.renderer.root.findDescendantById("dialog") as BoxRenderable;
  expect(dialog.backgroundColor.a).toBe(1);
  expect(dialog.width).toBeLessThanOrEqual(120);
  expect(dialog.height).toBeLessThanOrEqual(40);
  expect(dialog.screenX).toBeGreaterThanOrEqual(0);
  expect(dialog.screenY).toBeGreaterThanOrEqual(0);
  expect(setup.renderer.root.findDescendantById("region:workbench")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("cancelling session creation in an empty installation returns to the chooser", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({ snapshot: snapshotFixture({ sessions: [] }) })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  expect(statusText(setup)).toContain(`${icons.return}/${icons.space} Activate`);
  expect(statusText(setup)).toContain(`${icons.keyboard} r Reconnect`);
  expect(statusText(setup)).toContain(`${icons.keyboard} q Quit`);
  expect(statusText(setup)).not.toContain(`${icons.escape} Cancel`);
  expect(statusText(setup)).not.toContain(`${icons.return} Attach`);
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("New session");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  expect(statusText(setup)).toContain(`${icons.return} Submit`);
  expect(statusText(setup)).toContain(`${icons.escape} Cancel`);

  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("No sessions yet.");
  expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressKeys(["\x00n"]));
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();
  const create = setup.renderer.root.findDescendantById("session:create")!;
  await act(async () => setup.mockMouse.click(create.screenX, create.screenY));
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  act(() => setup.renderer.destroy());
});

test("closing a dialog with a stale return pane focuses the valid native tab fallback", async () => {
  let changeSnapshot!: Dispatch<SetStateAction<Snapshot>>;
  function SnapshotHarness() {
    const [snapshot, setSnapshot] = useState(splitSurfaceSnapshot);
    changeSnapshot = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<SnapshotHarness />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const original = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    const fallback = setup.renderer.root.findDescendantById("region:tabs")!;
    expect(setup.renderer.currentFocusedRenderable).toBe(original);
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    await act(async () => setup.mockInput.typeText("Retained"));
    await act(async () =>
      changeSnapshot((snapshot) => ({
        ...snapshot,
        revision: snapshot.revision + 1,
        tabs: snapshot.tabs.map((tab) => ({ ...tab, layout: { type: "pane", paneId: "pane-2" } })),
        panes: snapshot.panes.filter(({ id }) => id !== "pane-1"),
      })),
    );
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("create:name")).toBe(input);
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    expect(input.value).toBe("Retained");
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("region:tabs")).toBe(fallback);
    expect(setup.renderer.currentFocusedRenderable).toBe(fallback);
    expect(fallback.focused).toBe(true);
    expect(fallback.isDestroyed).toBe(false);
    expect(fallback.visible).toBe(true);
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("modal status scrolling leaves dialog focus and background selection intact", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({ connectionError: "Connection detail ".repeat(10) })}
    />,
    {
      width: 80,
      height: 20,
      kittyKeyboard: true,
    },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await setup.flush();
    const target = setup.renderer.currentFocusedRenderable!;
    expect(target.id).toBe("session:search");
    const area = setup.renderer.root.findDescendantById(
      "status-scroll:viewport",
    ) as ScrollBoxRenderable;
    expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
    await act(async () =>
      setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
    );
    const right = setup.renderer.root.findDescendantById("status-scroll:right")!;
    await act(async () => setup.mockMouse.click(right.screenX, right.screenY));
    await setup.flush();
    expect(area.scrollLeft).toBeGreaterThan(0);
    expect(setup.renderer.currentFocusedRenderable === target).toBe(true);
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:workspace-shared") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
    const overlay = setup.renderer.root.findDescendantById("dialog")!.parent!;
    const status = setup.renderer.root.findDescendantById("status")!;
    expect(overlay.screenY + overlay.height).toBeLessThanOrEqual(status.screenY);
    const badge = setup.captureSpans().lines[19]!.spans.find(({ text }) => text.includes("ERROR"))!;
    expect(badge.bg.toInts()).toEqual(parseColor(defaultTheme.colors.error).toInts());
    await act(async () => setup.mockInput.pressKey("n"));
    expect((target as InputRenderable).value).toBe("n");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("dialogs blur and restore the focused terminal", async () => {
  const received: { paneId: string; bytes: number[] }[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        stream: streamFixture({
          close: () => {},
          sendInput: (paneId, bytes) => received.push({ paneId, bytes: [...bytes] }),
        }),
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
  expect(terminal.focused).toBe(true);
  await act(async () => setup.mockInput.pressTab());
  expect(received).toEqual([{ paneId: "pane-1", bytes: [9] }]);

  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();
  expect(terminal?.focused).toBe(false);
  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  expect(received).toEqual([{ paneId: "pane-1", bytes: [9] }]);
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);

  await act(async () => {
    await setup.mockMouse.click(terminal!.screenX + 1, terminal!.screenY + 1);
  });
  expect(terminal?.focused).toBe(true);
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  expect(received).toEqual([{ paneId: "pane-1", bytes: [9] }]);
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();

  await act(async () => setup.mockInput.pressEscape());
  expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
  expect(terminal?.focused).toBe(true);
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(received).toEqual([
    { paneId: "pane-1", bytes: [9] },
    { paneId: "pane-1", bytes: [27, 91, 90] },
  ]);
  act(() => setup.renderer.destroy());
});

test("session dialog traps tab focus above the mounted terminal", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();

  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");

  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog:cancel");
  await act(async () => setup.mockInput.pressTab());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");

  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog:cancel");
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
  await act(async () => setup.mockInput.pressTab({ shift: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  act(() => setup.renderer.destroy());
});

test("session command browses without activation and confirms its cursor with Enter", async () => {
  const snapshot = snapshotFixture();
  snapshot.sessions.push({ id: "session-third", name: "Third", position: 2 });
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
  expect(list).toBeInstanceOf(InputRenderable);
  expect(list.focused).toBe(true);
  const sessionName = setup.renderer.root
    .findDescendantById("region:session")!
    .getChildren()[1] as TextRenderable;

  await act(async () => setup.mockInput.pressArrow("up"));
  await setup.flush();
  expect(sessionName.plainText).toBe("Select session...");

  await act(async () => setup.mockInput.pressArrow("down"));
  await act(async () => setup.mockInput.pressKey("p", { ctrl: true }));

  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(sessionName.plainText).toBe("Personal");
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  act(() => setup.renderer.destroy());
});

test("session command preserves create and cancel shortcuts", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  await act(async () => setup.mockInput.pressKeys(["\x00n"]));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("New session");
  await act(async () => setup.mockInput.pressEscape());
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await act(async () => setup.mockInput.pressEscape());
  expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  act(() => setup.renderer.destroy());
});

test("chooser search keeps n local, Ctrl+C clears it, and Escape dismisses a pending prefix", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const origin = setup.renderer.currentFocusedRenderable;
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    const query = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    await act(async () => setup.mockInput.typeText("njk"));
    await setup.flush();
    expect(query.value).toBe("njk");
    expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
    await act(async () => setup.mockInput.pressKeys(["\x00\x03"]));
    await setup.flush();
    expect(query.value).toBe("");
    expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
    expect(statusText(setup)).not.toContain("Invalid leader");
    await act(async () => setup.mockInput.typeText("unchanged"));
    await act(async () => setup.mockInput.pressKeys(["\x00\x1b[27u"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(origin);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const [direction, tab] of [
  ["forward", "\t"],
  ["backward", "\x1b[Z"],
] as const) {
  test(`buffered chooser leader takes priority over ${direction} Tab`, async () => {
    const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    try {
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      await setup.flush();
      const query = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
      await act(async () => setup.mockInput.pressKeys([`\x00${tab}n`]));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
      expect(query.value).toBe("n");
      expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
      expect(statusText(setup)).toContain("Invalid leader key: tab");
      await act(async () => setup.mockInput.pressTab());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("chooser repairs a removed match without attaching a stale session", async () => {
  const snapshot = snapshotFixture({
    sessions: [
      { id: "gone", name: "Remove me", position: 0 },
      { id: "keep-a", name: "Keep A", position: 1 },
      { id: "keep-b", name: "Keep B", position: 2 },
    ],
  });
  let update!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [current, setCurrent] = useState(snapshot);
    update = setCurrent;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: current })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    const query = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    await act(async () => setup.mockInput.typeText("Remove"));
    await act(async () =>
      update((current) => ({
        ...current,
        revision: current.revision + 1,
        sessions: current.sessions.filter(({ id }) => id !== "gone"),
      })),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(query);
    expect(query.value).toBe("Remove");
    expect(setup.captureCharFrame()).toContain("No matching sessions.");
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(
      (setup.renderer.root.findDescendantById("region:session")!.getChildren()[1] as TextRenderable)
        .plainText,
    ).toBe("Select session...");
    expect(setup.renderer.root.findDescendantById("session:create")).toBeDefined();
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("session command activates the clicked row after scrolling and resizing", async () => {
  const sessions = Array.from({ length: 30 }, (_, position) => ({
    id: `session-${position}`,
    name: `Session ${position}`,
    position,
  }));
  const calls: string[] = [];
  const setup = await testRender(
    <Dialog open>
      <SessionChooser
        canCancel={false}
        sessions={sessions}
        onSelect={(id) => calls.push(`select:${id}`)}
        onCreate={() => {}}
      />
    </Dialog>,
    { width: 40, height: 12, kittyKeyboard: true },
  );
  await setup.flush();
  const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
  expect(list).toBeInstanceOf(InputRenderable);
  act(() => list.focus());
  await act(async () => setup.mockInput.typeText("Session 29"));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("Session 29");
  expect(setup.captureCharFrame()).not.toContain("Session 0");
  act(() => setup.resize(40, 10));
  await setup.flush();
  calls.length = 0;
  const row = setup.renderer.root.findDescendantById("session:item:session-29")!;
  await act(async () => setup.mockMouse.click(row.screenX + 2, row.screenY));
  expect(calls).toEqual(["select:session-29"]);
  act(() => setup.renderer.destroy());
});

test("focused session create button handles Enter without selecting the session cursor", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await act(async () => setup.mockInput.pressEnter());
  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await act(async () => setup.mockInput.pressKey("j"));
  act(() => setup.renderer.root.findDescendantById("session:create")?.focus());
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");

  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("New session");
  expect(
    (setup.renderer.root.findDescendantById("region:session")!.getChildren()[1] as TextRenderable)
      .plainText,
  ).toBe("Personal");
  act(() => setup.renderer.destroy());
});

test("session button never browses its sibling list", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("session:search") as InputRenderable;
    act(() => setup.renderer.root.findDescendantById("session:create")!.focus());
    const query = list.value;
    const keys = [
      ["j", {}],
      ["k", {}],
      ["ARROW_DOWN", {}],
      ["ARROW_UP", {}],
      ["g", {}],
      ["g", { shift: true }],
      ["n", { ctrl: true }],
      ["p", { ctrl: true }],
      ["d", { ctrl: true }],
      ["u", { ctrl: true }],
    ] as const;
    for (const [name, modifiers] of keys) {
      await act(async () => setup.mockInput.pressKey(name, modifiers));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
      expect(list.value).toBe(query);
    }
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("creation input edits navigation letters with Ctrl+h and submits the edited name", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "result-1" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    const input = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    await act(async () => setup.mockInput.pressKeys(["n", "j", "k"]));
    expect(input.value).toBe("njk");
    await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
    await setup.flush();
    expect(input.value).toBe("nj");
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    expect(commands).toEqual([]);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(commands).toEqual([{ type: "session.create", name: "nj" }]);
    expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("creation failure preserves the native name input and focus", async () => {
  const pending = deferred<CommandResponse>();
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: (command) => {
          commands.push(command);
          return pending.promise;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await act(async () => setup.mockInput.typeText("Repeated"));
    await setup.flush();
    const nameInput = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    expect(setup.renderer.currentFocusedRenderable).toBe(nameInput);
    await act(async () => setup.mockInput.pressEnter());
    expect(commands).toEqual([{ type: "session.create", name: "Repeated" }]);
    expect(setup.renderer.currentFocusedRenderable).toBe(nameInput);
    await act(async () => {
      pending.reject(new Error("Name already exists"));
      await pending.promise.catch(() => {});
    });
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("create:name")).toBe(nameInput);
    expect(setup.renderer.currentFocusedRenderable).toBe(nameInput);
    expect(nameInput.value).toBe("Repeated");
    expect(setup.captureCharFrame()).toContain("Name already exists");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered typing, Tab and Create submit the full name and preserve button focus on failure", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: async (command) => {
          commands.push(command);
          throw new Error("Name already exists");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    const name = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    const create = setup.renderer.root.findDescendantById("create:submit")!;
    await act(async () => setup.mockInput.pressKeys(["  Buffered name  \t\r"]));
    await setup.flush();
    expect(commands).toEqual([{ type: "session.create", name: "Buffered name" }]);
    expect(setup.renderer.currentFocusedRenderable).toBe(create);
    expect(setup.renderer.root.findDescendantById("create:name")).toBe(name);
    expect(name.value).toBe("  Buffered name  ");
    expect(setup.captureCharFrame()).toContain("Name already exists");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("session creation shows required-name feedback without sending an invalid command", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: snapshotFixture({ sessions: [] }),
        command: async (command) => {
          commands.push(command);
          throw new Error("Server unavailable");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    const name = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    const create = setup.renderer.root.findDescendantById("create:submit")!;
    for (const value of ["", "   "]) {
      act(() => name.focus());
      await act(async () => setup.mockInput.typeText(value));
      await setup.flush();
      await act(async () => setup.mockMouse.click(create.screenX, create.screenY));
      await setup.flush();
      expect(commands).toEqual([]);
      expect(setup.captureCharFrame()).toContain("Name is required.");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:submit");
      expect(name.value).toBe(value);
    }
    act(() => name.focus());
    await act(async () => setup.mockInput.typeText("Fixed"));
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Name is required.");
    await act(async () => setup.mockMouse.click(create.screenX, create.screenY));
    await setup.flush();
    expect(commands).toEqual([{ type: "session.create", name: "Fixed" }]);
    expect(setup.captureCharFrame()).toContain("Server unavailable");
    expect(name.value).toBe("   Fixed");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const action of ["escape", "cancel", "backdrop"] as const) {
  test(`startup form ${action} returns to a non-dismissible chooser`, async () => {
    const setup = await testRender(
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot: snapshotFixture({ sessions: [] }),
        })}
      />,
      { width: 120, height: 40, kittyKeyboard: true },
    );
    try {
      await setup.flush();
      await act(async () => setup.mockInput.pressEnter());
      await setup.flush();
      const name = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
      await act(async () => setup.mockInput.typeText("clear me"));
      await act(async () => setup.mockInput.pressCtrlC());
      expect(name.value).toBe("");
      expect(setup.renderer.currentFocusedRenderable).toBe(name);
      await act(async () => setup.mockInput.pressKeys(["\x00n"]));
      expect(name.value).toBe("n");
      await act(async () => setup.mockInput.typeText("draft"));
      if (action === "escape") {
        await act(async () => setup.mockInput.pressEscape());
      } else if (action === "cancel") {
        const cancel = setup.renderer.root.findDescendantById("dialog:cancel")!;
        await act(async () => setup.mockMouse.click(cancel.screenX, cancel.screenY));
      } else {
        await act(async () => setup.mockMouse.click(0, 0));
      }
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("create:name")).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
      expect(setup.renderer.root.findDescendantById("dialog:cancel")).toBeUndefined();
      await act(async () => setup.mockInput.pressKeys(["\x00\x1b[27u"]));
      await act(async () => setup.mockMouse.click(0, 0));
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("dialogs block background commands and mouse activation while allowing reconnect", async () => {
  const commands: Command[] = [];
  let reloads = 0;
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: twoSurfaceSnapshot(),
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "result-1" } };
        },
        reload: async () => {
          reloads += 1;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    const commandCount = commands.length;
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    for (const dialog of ["sessions", "create"] as const) {
      if (dialog === "create") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        await act(async () => setup.mockInput.pressKeys(["\x00n"]));
        await setup.flush();
      }
      const endpoint = dialog === "sessions" ? "session:search" : "create:name";
      for (const name of ["h", "j", "k", "l", "[", "]", "n", "s"]) {
        await act(async () => setup.mockInput.pressKey(name, { hyper: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(endpoint);
      }
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey("v"));
      await act(async () => setup.mockInput.pressKey("r", { hyper: true }));
      expect(reloads).toBe(dialog === "sessions" ? 1 : 2);
      await act(async () => setup.mockMouse.pressDown(terminal.screenX + 1, terminal.screenY + 1));
      expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
      expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
      await act(async () => setup.mockMouse.release(terminal.screenX + 1, terminal.screenY + 1));
      await setup.flush();
      expect(commands.length).toBe(commandCount);
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
      expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
      expect(terminal.focused).toBe(true);
      expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
    }
    await act(async () => setup.mockInput.pressKey("b"));
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(terminal.focused).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("modal quit destroys the renderer", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: snapshotFixture() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("q", { hyper: true }));
    expect(setup.renderer.isDestroyed).toBe(true);
  } finally {
    if (!setup.renderer.isDestroyed) {
      act(() => setup.renderer.destroy());
    }
  }
});

test("opening a dialog by mouse clears a pending shell leader", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await setup.flush();
    expect(statusText(setup).startsWith("LEADER ")).toBe(true);
    const session = setup.renderer.root.findDescendantById("region:session")!;
    await act(async () => setup.mockMouse.click(session.screenX + 1, session.screenY));
    await setup.flush();
    expect(statusText(setup).startsWith("LEADER ")).toBe(false);
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable).toBe(session);
    await act(async () => setup.mockInput.pressKey("b"));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(session);
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(statusText(setup).startsWith("LEADER ")).toBe(false);
    expect(setup.captureCharFrame()).not.toContain("ERROR");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("unavailable modal scopes consume input instead of sending it to the retained terminal", async () => {
  let reloads = 0;
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        reload: async () => {
          reloads += 1;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1")!;
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    const overlay = setup.renderer.root.findDescendantById("dialog")!;
    const parent = overlay.parent!;
    const received: string[] = [];
    terminal.onKeyDown = (key) => received.push(key.name);
    for (const unavailable of ["hidden", "missing"] as const) {
      act(() => {
        if (unavailable === "hidden") {
          overlay.visible = false;
        } else {
          parent.remove(overlay);
        }
        terminal.focus();
      });
      await act(async () => {
        setup.mockInput.pressTab();
        setup.mockInput.pressTab({ shift: true });
        setup.mockInput.pressKey("x");
        setup.mockInput.pressKey("h", { ctrl: true });
      });
      expect(received).toEqual([]);
      await act(async () => setup.mockInput.pressKey("r", { hyper: true }));
      expect(reloads).toBe(unavailable === "hidden" ? 1 : 2);
    }
    await act(async () => {
      parent.add(overlay);
      overlay.visible = true;
      await setup.flush();
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
  } finally {
    act(() => setup.renderer.destroy());
  }
});
