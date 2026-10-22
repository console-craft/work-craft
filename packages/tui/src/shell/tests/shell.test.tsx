import { expect, test } from "bun:test";

import { BoxRenderable, parseColor } from "@opentui/core";
import {
  type Command,
  type CommandResponse,
  type ControlSnapshot,
} from "@work-craft/server/client";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { WorkCraftShell } from "@/shell/shell.tsx";
import {
  deferred,
  liveInputFixture,
  openFixtureItem,
  statusText,
  surfaceSnapshot,
  testRender,
  twoSurfaceSnapshot,
  workCraftStateFixture,
} from "@/shell/tests/fixtures";
import { snapshotFixture } from "@/tests/support/fixtures.ts";
import { icons } from "@/ui/icons/nerd";
import { getControlHints } from "@/ui/interaction/control-hints";
import { defaultTheme } from "@/ui/theming/themes/default.ts";

test("status acceptance hints follow list, Tab, button and creation input focus", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  function assertHints(action: string, create: boolean): void {
    const text = statusText(setup);
    expect(text).toContain(action);
    expect(text).toContain(`${icons.keyboard} r Reconnect`);
    expect(text).toContain(`${icons.keyboard} q Quit`);
    expect(text).toContain(`${icons.escape} Cancel`);
    expect(text.includes(`${icons.space} n Create`)).toBe(create);
    for (const movement of [
      `${icons.control} h`,
      `${icons.control} j`,
      `${icons.control} k`,
      `${icons.control} l`,
      icons.tab,
      `${icons.keyboard} j`,
    ]) {
      expect(text).not.toContain(movement);
    }
  }
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    assertHints(`${icons.return} Attach`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    expect(statusText(setup)).not.toContain("Attach");
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("dialog:cancel");
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return} Attach`, true);
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    assertHints(`${icons.return}/${icons.space} Activate`, true);
    await act(async () => setup.mockInput.pressKey(" "));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    assertHints(`${icons.return} Submit`, false);
    expect(statusText(setup)).not.toContain("Activate");
    expect(statusText(setup)).not.toContain("Attach");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("session attachment focuses workspace without resetting focus on refresh", async () => {
  let publish!: Dispatch<SetStateAction<ControlSnapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(workCraftStateFixture().snapshot!);
    publish = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    await act(async () =>
      publish((snapshot) => ({ ...snapshot, revision: snapshot.revision + 1 })),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace browsing follows rendered order after a shared-workspace session switch", async () => {
  const commands: Command[] = [];
  const base = snapshotFixture();
  const snapshot = {
    ...base,
    navigation: base.sessions.map(({ id }) => ({
      ...base.navigation[0]!,
      sessionId: id,
      generation: 1,
      workspaceId: "a",
      category: null,
      itemId: null,
      tabId: null,
      paneId: null,
    })),
    workspaces: [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
      { id: "c", name: "Gamma" },
    ],
    sessionWorkspaces: [
      { sessionId: "session-work", workspaceId: "a", position: 0 },
      { sessionId: "session-work", workspaceId: "b", position: 1 },
      { sessionId: "session-work", workspaceId: "c", position: 2 },
      { sessionId: "session-personal", workspaceId: "a", position: 0 },
      { sessionId: "session-personal", workspaceId: "c", position: 1 },
      { sessionId: "session-personal", workspaceId: "b", position: 2 },
    ],
  };
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot,
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 4, result: { id: "c" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["Work\r"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["Personal\r"]));
    await setup.flush();
    const group = setup.renderer.root.findDescendantById("region:workspace")!;
    expect(
      group
        .findDescendantById("workspace-scroll:viewport")!
        .getChildren()
        .map(({ id }) => id),
    ).toEqual(["workspace:a", "workspace:c", "workspace:b"]);
    act(() => {
      setup.mockInput.pressKey("l");
      setup.mockInput.pressEnter();
    });
    await setup.flush();
    expect(commands.at(-1)).toEqual({
      type: "session.navigate",
      sessionId: "session-personal",
      target: { kind: "workspace", workspaceId: "c" },
    });
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const activation of ["Enter", "Space", "mouse"] as const) {
  test(`workspace activation enters category (${activation})`, async () => {
    const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    try {
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
      await setup.flush();
      await act(async () => {
        if (activation === "mouse") {
          const row = setup.renderer.root.findDescendantById("workspace:workspace-shared")!;
          await setup.mockMouse.click(row.screenX, row.screenY);
        } else if (activation === "Space") {
          setup.mockInput.pressKey(" ");
        } else {
          setup.mockInput.pressEnter();
        }
      });
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("session reselection drills down while cancellation restores its origin", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("an attached empty workspace bar allows creation but cannot activate", async () => {
  const snapshot = { ...workCraftStateFixture().snapshot!, workspaces: [], sessionWorkspaces: [] };
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:name");
    expect(setup.captureCharFrame()).toContain("New workspace");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const width of [120, 80]) {
  for (const empty of [false, true]) {
    for (const activation of ["Enter", "Space", "mouse"] as const) {
      test(`category activation enters navigation (${width}, empty=${empty}, ${activation})`, async () => {
        const snapshot = workCraftStateFixture().snapshot!;
        const setup = await testRender(
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot: empty ? { ...snapshot, items: [] } : snapshot,
            })}
          />,
          { width, height: 40, kittyKeyboard: true },
        );
        try {
          await setup.flush();
          act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
          await setup.flush();
          await act(async () => {
            if (activation === "mouse") {
              const row = setup.renderer.root.findDescendantById("category:implementation")!;
              await setup.mockMouse.click(row.screenX + 2, row.screenY);
            } else if (activation === "Space") {
              setup.mockInput.pressKey(" ");
            } else {
              setup.mockInput.pressEnter();
            }
          });
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
        } finally {
          act(() => setup.renderer.destroy());
        }
      });
    }
  }
}

test("Hyper category selection preserves focus and a hidden navigator", async () => {
  const snapshot = {
    ...snapshotFixture(),
    sessions: [{ id: "session-work", name: "Work", position: 0 }],
  };
  function Fixture() {
    const [current, setSnapshot] = useState(snapshot);
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot: current,
          command: async (command) => {
            expect(command).toEqual({
              type: "session.step",
              sessionId: "session-work",
              level: "category",
              direction: 1,
            });
            const navigation = {
              ...current.navigation[0]!,
              generation: 2,
              category: "today" as const,
            };
            setSnapshot({ ...current, revision: 5, navigation: [navigation] });
            return { ok: true, revision: 5, result: { id: "session-work", navigation } };
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKeys(["\x00b"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("l", { hyper: true }));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    const selected = setup.renderer.root.findDescendantById("category:today") as BoxRenderable;
    expect(selected.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.muted).toInts(),
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("workspace activation drills down locally while shared selection waits for acknowledgment", async () => {
  const base = workCraftStateFixture().snapshot!;
  const snapshot = {
    ...base,
    navigation: [{ ...base.navigation[0]!, category: "inbox" as const, itemId: null }],
    categories: [
      { workspaceId: "workspace-shared", kind: "inbox" as const, title: "Inbox", position: 0 },
      { workspaceId: "workspace-shared", kind: "today" as const, title: "Today", position: 1 },
      { workspaceId: "workspace-work", kind: "inbox" as const, title: "Inbox", position: 0 },
      { workspaceId: "workspace-work", kind: "today" as const, title: "Today", position: 1 },
    ],
  };
  const response = deferred<CommandResponse>();
  let publish!: Dispatch<SetStateAction<ControlSnapshot>>;
  function Fixture() {
    const [current, setSnapshot] = useState<ControlSnapshot>(snapshot);
    publish = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot: current,
          command: async (command) => {
            if (command.type === "session.navigate" && command.target.kind === "category") {
              const navigation = {
                ...current.navigation[0]!,
                generation: 3,
                category: command.target.category,
              };
              setSnapshot({ ...current, revision: 6, navigation: [navigation] });
              return { ok: true, revision: 6, result: { id: "session-work", navigation } };
            }
            expect(command).toEqual({
              type: "session.navigate",
              sessionId: "session-work",
              target: { kind: "workspace", workspaceId: "workspace-work" },
            });
            return response.promise;
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    act(() => {
      setup.mockInput.pressKey("l");
      setup.mockInput.pressEnter();
    });
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    const navigation = { ...snapshot.navigation[0]!, generation: 2, workspaceId: "workspace-work" };
    act(() => publish({ ...snapshot, revision: 5, navigation: [navigation] }));
    await act(async () =>
      response.resolve({ ok: true, revision: 5, result: { id: "workspace-work", navigation } }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    await act(async () => setup.mockInput.pressKey("j"));
    expect(
      (
        setup.renderer.root.findDescendantById("workspace:workspace-work") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
    expect(
      (
        setup.renderer.root.findDescendantById("category:today") as BoxRenderable
      ).backgroundColor.toInts(),
    ).toEqual(parseColor(defaultTheme.colors.focus).toInts());
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    expect(setup.captureCharFrame()).toContain("TODAY");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("category Enter enters expanded and compact navigators while project Enter stays local", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
    act(() => setup.resize(119, 40));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const initiallyHidden of [false, true]) {
  test(`buffered category activation cannot undo navigator reveal (hidden=${initiallyHidden})`, async () => {
    const snapshot = {
      ...snapshotFixture(),
      sessions: [{ id: "session-work", name: "Work", position: 0 }],
    };
    const setup = await testRender(
      <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
      { width: 120, height: 40, kittyKeyboard: true },
    );
    try {
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
      if (initiallyHidden) {
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
        await setup.flush();
        expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
        await act(async () => setup.mockInput.pressKeys(["\rj\r"]));
      } else {
        await act(async () => setup.mockInput.pressKeys(["\x00b\r"]));
      }
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("category activation reveals a manually hidden navigator and retains focus", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("b"));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.renderOnce());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("b"));
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    act(() => setup.resize(120, 4));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    act(() => setup.resize(120, 40));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("region:navigator")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("category Enter enters an empty navigator so its create action is accessible", async () => {
  const snapshot = { ...surfaceSnapshot(), items: [] };
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey("n"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:path");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const unavailable of ["empty", "undersized"] as const) {
  test(`item Enter keeps navigator focus when its workbench is ${unavailable}`, async () => {
    const snapshot = surfaceSnapshot();
    if (unavailable === "empty") {
      snapshot.tabs[0]!.layout = null;
    }
    const setup = await testRender(
      <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
      {
        width: 120,
        height: unavailable === "undersized" ? 8 : 40,
        kittyKeyboard: true,
      },
    );
    try {
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
      await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey("l"));
      await act(async () => setup.mockInput.pressKey("j"));
      await act(async () => setup.mockInput.pressEnter());
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("mouse category activation drills down and item release enters while Hyper selection does not", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    const category = setup.renderer.root.findDescendantById("category:implementation")!;
    await act(async () => setup.mockMouse.click(category.screenX + 2, category.screenY));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKey("l"));
    await setup.flush();
    const item = setup.renderer.root.findDescendantById("navigator-row:item-1")!;
    await act(async () => setup.mockMouse.click(item.screenX + 2, item.screenY));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    act(() => setup.renderer.root.findDescendantById("region:navigator")!.focus());
    await act(async () => setup.mockInput.pressKey("k", { hyper: true }));
    await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered spatial movement uses the actual native source", async () => {
  const setup = await liveInputFixture();
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    await openFixtureItem(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressKeys(["\x0c", "\x0c"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("spatial entry retains its intent while a newly mounted canonical terminal becomes native-ready", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    act(() => setup.renderer.root.findDescendantById("region:navigator")!.focus());
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("mouse session opening restores the native session endpoint", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const session = setup.renderer.root.findDescendantById("region:session")!;
    await act(async () => setup.mockMouse.click(session.screenX + 1, session.screenY));
    expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Tab stays within the header and reaches the session button", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
    const session = setup.renderer.root.findDescendantById("region:session")!;
    act(() => workspace.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
    await act(async () => setup.mockInput.pressTab({ shift: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => {
      await setup.mockInput.pressTab();
      await setup.mockInput.pressTab();
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    await act(async () => setup.mockInput.pressTab({ shift: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:create");
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(session);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("header Tab does not steal modified Tab or active leader input", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    const workspace = setup.renderer.root.findDescendantById("region:workspace")!;
    act(() => workspace.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressTab({ ctrl: true }));
    expect(setup.renderer.currentFocusedRenderable).toBe(workspace);
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await setup.flush();
    await act(async () => setup.mockInput.pressTab());
    await setup.flush();
    expect(statusText(setup)).toContain("Invalid leader key: tab");
    expect(setup.renderer.currentFocusedRenderable).toBe(workspace);
    const category = setup.renderer.root.findDescendantById("region:category")!;
    act(() => category.focus());
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable).toBe(category);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered leader prefix takes priority over header Tab", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00\t"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    expect(statusText(setup)).toContain("Invalid leader key: tab");
    await act(async () => setup.mockInput.pressTab());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("spatial header movement uses the rendered controls after resizing", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    for (const width of [120, 80]) {
      act(() => setup.resize(width, 40));
      await setup.flush();
      act(() => setup.renderer.root.findDescendantById("region:workspace")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:session");
      await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:workspace");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each(["Enter", "Space", "Hyper+s"] as const)(
  "session switcher opens with %s and restores the initiating focus",
  async (key) => {
    const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    try {
      await setup.flush();
      const session = setup.renderer.root.findDescendantById("region:session")!;
      if (key !== "Hyper+s") {
        act(() => session.focus());
        await setup.flush();
      }
      const returnTarget = setup.renderer.currentFocusedRenderable;
      await act(async () => {
        if (key === "Enter") {
          await setup.mockInput.pressEnter();
        } else if (key === "Space") {
          await setup.mockInput.pressKey(" ");
        } else {
          await setup.mockInput.pressKey("s", { hyper: true });
        }
      });
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("dialog")).toBeDefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("session:search");
      await act(async () => setup.mockInput.pressEscape());
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable).toBe(returnTarget);
      if (key !== "Hyper+s") {
        expect(getControlHints(session)).toContainEqual({ keys: "Enter/Space", label: "Activate" });
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test("buffered movement through tabs restores the last native pane", async () => {
  const setup = await liveInputFixture();
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKeys(["\x0c", "\x0c", "\x0b", "\n"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("buffered project expansion requests remain explicit and idempotent", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKeys(["k", "h", "h"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("navigator-row:item-1")).toBeUndefined();
    await act(async () => setup.mockInput.pressKeys(["l", "h", "l", "l"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("navigator-row:item-1")).toBeDefined();
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered spatial movement recomputes contextual creation from the native source", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKeys(["\x0c", "n"]));
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Register directory");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:path");
    await act(async () => setup.mockInput.pressEscape());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a direct tab request while undersized cancels automatic workbench restoration", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: 1, result: { id: "tab-1" } };
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    act(() => setup.resize(120, 8));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    expect(commands.at(-1)).toEqual({
      type: "session.navigate",
      sessionId: "session-work",
      target: { kind: "tab", tabId: "tab-1" },
    });
    act(() => setup.resize(120, 40));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a cancelled click on a stretched tab cancels automatic workbench restoration", async () => {
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
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
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    act(() => setup.resize(120, 8));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    const tabs = setup.renderer.root.findDescendantById("region:tabs")!;
    const label = setup.renderer.root.findDescendantById("tab:tab-1")!;
    const x = tabs.screenX + tabs.width - 1;
    expect(x).toBe(label.screenX + label.width - 1);
    const count = commands.length;
    await act(async () => setup.mockMouse.pressDown(x, tabs.screenY));
    await act(async () => setup.mockMouse.release(x, tabs.screenY + tabs.height));
    expect(commands).toHaveLength(count);
    act(() => setup.resize(120, 40));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("leader status resolves commands and reports invalid input", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await setup.flush();
  expect(statusText(setup).startsWith("LEADER ")).toBe(true);
  expect(statusText(setup)).not.toContain(`${icons.return} Activate`);
  await act(async () => setup.mockInput.pressKey("x"));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("ERROR");
  expect(setup.captureCharFrame()).toMatch(/Invalid.leader.key:.x/);
  act(() => setup.renderer.destroy());
});

test("navigator hides, restores expanded, and resizes one column", async () => {
  const setup = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  const navigator = setup.renderer.root.findDescendantById("navigator-controls")!;
  const initialWidth = navigator.width;
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(navigator.width).toBe(initialWidth);

  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("ARROW_RIGHT", { ctrl: true }));
  await setup.flush();
  expect(navigator.width).toBe(initialWidth + 1);
  act(() => setup.renderer.destroy());
});

test("narrow shells start hidden rather than compact", async () => {
  const compact = await testRender(<WorkCraftShell workCraft={workCraftStateFixture()} />, {
    width: 119,
    height: 20,
    kittyKeyboard: true,
  });
  await compact.flush();
  expect(compact.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(false);
  act(() => compact.renderer.destroy());
});

test("undersizing a focused workbench moves focus to its tab", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")?.focused).toBe(true);

  act(() => setup.resize(120, 8));
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("terminal:pane-1")?.focused).toBe(false);

  act(() => setup.resize(120, 40));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")?.focused).toBe(true);
  act(() => setup.renderer.destroy());
});

test("shared item navigation follows the selected pane when local focus is already in the workbench", async () => {
  const setup = await liveInputFixture(twoSurfaceSnapshot());
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(true);

  await act(async () => setup.mockInput.pressKey("j", { ctrl: true }));
  expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(true);
  act(() => setup.renderer.destroy());
  setup.store.stop();
});

test("disconnected durable commands are disabled while reload remains available", async () => {
  let commands = 0;
  let reloads = 0;
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        status: "disconnected",
        command: async () => {
          commands += 1;
          throw new Error("offline");
        },
        reload: async () => {
          reloads += 1;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
  await act(async () => setup.mockInput.pressKey("r", { hyper: true }));
  expect(commands).toBe(0);
  expect(reloads).toBe(1);
  act(() => setup.renderer.destroy());
});

test("shell-only state changes preserve terminal renderable identity", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  const terminal = setup.renderer.root.findDescendantById("terminal:pane-1");
  expect(terminal).toBeDefined();

  for (const region of ["workspace", "category"] as const) {
    act(() => setup.renderer.root.findDescendantById(`region:${region}`)!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("l"));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
  }

  await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
  await act(async () => setup.mockInput.pressEscape());
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("b"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
  act(() => setup.renderer.destroy());
});

test("spatial focus moves between workbench panes", async () => {
  const setup = await liveInputFixture();
  await setup.flush();
  await openFixtureItem(setup);
  setup.commands.length = 0;
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("v"));
  expect(setup.commands.at(-1)).toEqual({
    type: "pane.split",
    paneId: "pane-2",
    direction: "vertical",
    activation: { sessionId: "session-work", generation: 2 },
  });
  act(() => setup.renderer.destroy());
  setup.store.stop();
});
