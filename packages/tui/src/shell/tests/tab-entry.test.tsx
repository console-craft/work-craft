import { expect, test } from "bun:test";

import {
  CliRenderEvents,
  EmbeddedTerminalRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { type Snapshot } from "@work-craft/server/client";
import { act } from "react";

import { WorkCraftShell } from "@/shell/shell.tsx";
import {
  liveInputFixture,
  localTabFixture,
  openFixtureItem,
  splitSurfaceSnapshot,
  statusText,
  surfaceSnapshot,
  testRender,
  twoTabSnapshot,
  workCraftStateFixture,
} from "@/shell/tests/fixtures";
import { getControlHints } from "@/ui/interaction/control-hints";

test("tab entry waits across a frame before the new terminal has native layout", async () => {
  const setup = await localTabFixture(false);
  try {
    await setup.next();
    await setup.respond();
    setup.publish(twoTabSnapshot("tab-2", 5));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-2a")!;
    expect(terminal.width).toBe(0);
    act(() => setup.renderer.emit(CliRenderEvents.FRAME, { frameId: 100 }));
    expect(statusText(setup)).not.toContain("too small");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2a");
    await act(async () => setup.mockInput.pressKey("x"));
    expect(setup.received).toEqual([{ paneId: "pane-2a", bytes: [120] }]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("explicit tab entry focuses the selected exited action without pressing; action-source Hyper and leader never become terminal input", async () => {
  const setup = await localTabFixture(false);
  try {
    const stopped = twoTabSnapshot("tab-1", 5);
    stopped.panes
      .filter((pane) => pane.id.startsWith("pane-1"))
      .forEach((pane) => {
        pane.processStatus = "exited";
      });
    setup.publish(stopped);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await act(async () => setup.mockInput.pressEnter());
    await setup.respond(0, 5);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reactivate:pane-1b");
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
    await act(async () => setup.mockInput.pressKeys(["\x00\x00"]));
    await act(async () => setup.mockInput.pasteBracketedText("not terminal data"));
    expect(setup.received).toEqual([]);
    await setup.next();
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.respond(1, 6);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).not.toStartWith("terminal:");
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const [width, height, eligible] of [
  [20, 4, true],
  [19, 4, false],
  [20, 3, false],
  [20, 2, false],
] as const) {
  test(`native ${width}x${height} action eligibility is separate from 20x5 terminal readiness`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.tabs[0]!.layout = {
      type: "split",
      direction: "vertical",
      ratio: width / 67,
      first: {
        type: "split",
        direction: "horizontal",
        ratio: height / 33,
        first: { type: "pane", paneId: "pane-1" },
        second: { type: "pane", paneId: "pane-3" },
      },
      second: { type: "pane", paneId: "pane-2" },
    };
    initial.panes[0]!.processStatus = "exited";
    initial.panes.push({ ...initial.panes[1]!, id: "pane-3" });
    const setup = await liveInputFixture(initial);
    try {
      const button = setup.renderer.root.findDescendantById("reactivate:pane-1")!;
      expect(button.focusable).toBe(eligible);
      const original = setup.renderer.root.findDescendantById("terminal:pane-1")!;
      expect(original.parent!.width).toBe(width);
      expect(original.visible).toBe(false);
      expect(original.parent!.height).toBe(height);
      if (eligible) {
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
        const next = structuredClone(initial);
        next.revision = 5;
        next.panes[0]!.processStatus = "running";
        await setup.publish(next);
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-1" } }),
        );
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(original.focusable).toBe(false);
        expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(original);
        expect(statusText(setup)).toContain("too small");
      }
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const order of ["response first", "snapshot first"] as const) {
  test(`buffered strip right/right/Enter waits for exact requested revision with ${order}`, async () => {
    const setup = await localTabFixture(false, 3);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\x1b[C\r")));
      expect(setup.commands).toEqual([
        { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
        { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-3" },
      ]);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      if (order === "response first") {
        await setup.respond(1, 6);
        setup.publish(twoTabSnapshot("tab-3", 5, 3));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      }
      setup.publish(twoTabSnapshot("tab-3", 6, 3));
      await setup.flush();
      if (order === "snapshot first") {
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        await setup.respond(1, 6);
      }
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-3a");
      await setup.respond(0, 5);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-3a");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const pointer of ["wheel", "arrow", "edge arrow"] as const) {
  for (const stage of ["before response", "after response", "snapshot first"] as const) {
    test(`contained strip ${pointer} cancels delayed entry ${stage} without undoing selection; fresh Enter works`, async () => {
      const setup = await localTabFixture(false, 12);
      try {
        const list = setup.renderer.root.findDescendantById("region:tabs")!;
        act(() => list.focus());
        await setup.flush();
        act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
        expect(setup.commands).toEqual([
          { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
        ]);
        if (stage === "after response") {
          await setup.respond();
        } else if (stage === "snapshot first") {
          setup.publish(twoTabSnapshot("tab-2", 5, 12));
        }
        await setup.flush();
        const area = setup.renderer.root.findDescendantById(
          "region:tabs:scroller:viewport",
        ) as ScrollBoxRenderable;
        expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
        expect(area.scrollLeft).toBe(0);
        const before = area.scrollLeft;
        if (pointer === "wheel") {
          await act(async () =>
            setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
          );
        } else {
          const arrow = setup.renderer.root.findDescendantById(
            `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
          )!;
          await act(async () => setup.mockMouse.pressDown(arrow.screenX, arrow.screenY));
          expect(area.scrollLeft).toBe(before);
          // Commit while held: primary down, not release/viewport movement, is newer intent.
        }
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        if (stage !== "after response") {
          await setup.respond();
        }
        setup.publish(twoTabSnapshot("tab-2", 5, 12));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.renderer.root.findDescendantById("terminal:pane-2a")).toBeDefined();
        expect(setup.commands).toHaveLength(1);
        if (pointer !== "wheel") {
          const arrow = setup.renderer.root.findDescendantById(
            `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
          )!;
          await act(async () => setup.mockMouse.release(arrow.screenX, arrow.screenY));
        }
        await setup.flush();
        if (pointer === "edge arrow") {
          expect(area.scrollLeft).toBe(before);
        } else {
          expect(area.scrollLeft).toBeGreaterThan(before);
        }
        setup.publish(twoTabSnapshot("tab-2", 6, 12));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.received).toEqual([]);
        await act(async () => setup.mockInput.pressEnter());
        expect(setup.commands.at(-1)).toEqual({
          type: "surface.selectTab",
          surfaceId: "surface-1",
          tabId: "tab-2",
        });
        await setup.respond(1, 6);
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2a");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }

  test(`contained strip ${pointer} preserves outside focus across late selection`, async () => {
    const setup = await localTabFixture(false, 12);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
      const outside = setup.renderer.root.findDescendantById("region:category")!;
      act(() => outside.focus());
      await setup.flush();
      const area = setup.renderer.root.findDescendantById(
        "region:tabs:scroller:viewport",
      ) as ScrollBoxRenderable;
      if (pointer === "wheel") {
        await act(async () =>
          setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
        );
      } else {
        const arrow = setup.renderer.root.findDescendantById(
          `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
        )!;
        await act(async () => setup.mockMouse.click(arrow.screenX, arrow.screenY));
      }
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
      setup.publish(twoTabSnapshot("tab-2", 5, 12));
      await setup.respond();
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
      expect(setup.commands).toHaveLength(1);
      expect(setup.received).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });

  for (const duplicate of [false, true]) {
    test(`contained strip ${pointer} cancels response-first restart entry (duplicate attempts=${duplicate})`, async () => {
      const setup = await localTabFixture(false, 12);
      try {
        const stopped = twoTabSnapshot("tab-1", 5, 12);
        stopped.panes.find((pane) => pane.id === "pane-1b")!.processStatus = "exited";
        setup.publish(stopped);
        await setup.flush();
        const button = setup.renderer.root.findDescendantById("reactivate:pane-1b")!;
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        await setup.respond(0, 7);
        await setup.flush();
        expect(button.focusable).toBe(false);
        const area = setup.renderer.root.findDescendantById(
          "region:tabs:scroller:viewport",
        ) as ScrollBoxRenderable;
        if (pointer === "wheel") {
          await act(async () =>
            setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
          );
        } else {
          const arrow = setup.renderer.root.findDescendantById(
            `region:tabs:scroller:${pointer === "edge arrow" ? "left" : "right"}`,
          )!;
          await act(async () => setup.mockMouse.click(arrow.screenX, arrow.screenY));
        }
        if (duplicate) {
          setup.publish({ ...stopped, revision: 6 });
          await setup.flush();
          expect(button.focusable).toBe(false);
          await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
          await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        }
        // Without duplicate attempts, scrolling is the only newer intent before readiness.
        setup.publish(twoTabSnapshot("tab-1", 7, 12));
        await setup.flush();
        expect(setup.commands).toEqual([{ type: "process.restart", paneId: "pane-1b" }]);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.received).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("fresh Enter after contained strip scrolling reuses the unresolved durable selection", async () => {
  const setup = await localTabFixture(false, 12);
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
    const edge = setup.renderer.root.findDescendantById("region:tabs:scroller:left")!;
    await act(async () => setup.mockMouse.click(edge.screenX, edge.screenY));
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    setup.publish(twoTabSnapshot("tab-2", 5, 12));
    await setup.respond();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2a");
    expect(setup.received).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("strip browsing selects without entry and a rejected latest selection restores active cursor", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    expect(setup.renderer.root.findDescendantById("terminal:pane-1b")).toBeDefined();
    await act(async () => setup.requests[0]!.reject(new Error("Selection rejected")));
    await setup.flush();
    expect(statusText(setup)).toContain("Selection rejected");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.at(-1)).toEqual({
      type: "surface.selectTab",
      surfaceId: "surface-1",
      tabId: "tab-1",
    });
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("rapid reversal ignores older failure and mouse intent supersedes pending strip entry", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\x1b[D\r")));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-1" },
    ]);
    const tab = setup.renderer.root.findDescendantById("tab:tab-2")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    expect(setup.commands).toHaveLength(3);
    await act(async () => setup.requests[0]!.reject(new Error("Obsolete selection")));
    await setup.respond(1, 6);
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await setup.respond(2, 7);
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    expect(statusText(setup)).not.toContain("Obsolete selection");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a newer control-source Hyper selection cannot be rolled back by the old strip request", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await setup.next();
    await act(async () => setup.requests[0]!.reject(new Error("Obsolete browse")));
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.at(-1)).toEqual({
      type: "surface.selectTab",
      surfaceId: "surface-1",
      tabId: "tab-2",
    });
    expect(statusText(setup)).not.toContain("Obsolete browse");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("clicking and reclicking the active tab enters via one guarded no-op selection", async () => {
  const setup = await localTabFixture();
  try {
    for (const revision of [5, 6]) {
      const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
      await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      expect(setup.commands).toHaveLength(revision - 4);
      expect(setup.commands.at(-1)).toEqual({
        type: "surface.selectTab",
        surfaceId: "surface-1",
        tabId: "tab-1",
      });
      await setup.respond(revision - 5, revision);
      setup.publish(twoTabSnapshot("tab-1", revision));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a newer explicit Enter reuses an active-tab selection without losing its response", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands).toHaveLength(1);
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-1", 5));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("entry after a settled browse obtains a fresh revision instead of reusing an obsolete selection", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.flush();
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey(" "));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    await setup.respond(1, 7);
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("disconnected strip browsing and activation send no commands or terminal input", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    setup.connect(false);
    await setup.flush();
    act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
    await setup.flush();
    expect(setup.commands).toEqual([]);
    expect(setup.received).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(statusText(setup)).not.toContain("Enter terminal");
    setup.connect(true);
    await setup.flush();
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const owner of ["item-1", "root-1"] as const) {
  for (const newerEntry of [false, true]) {
    test(`${owner} archive then unarchive before selection response cancels entry${newerEntry ? " without undoing newer intent" : " permanently"}`, async () => {
      const setup = await localTabFixture();
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
        expect(setup.commands).toHaveLength(1);
        setup.publish(twoTabSnapshot("tab-2", 5));
        await setup.flush();
        const archived = twoTabSnapshot("tab-2", 6);
        archived.items.find((item) => item.id === owner)!.archived = true;
        setup.publish(archived);
        await setup.flush();
        setup.publish(twoTabSnapshot("tab-2", 7));
        await setup.flush();
        if (newerEntry) {
          const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
          await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
          expect(setup.commands).toHaveLength(2);
        }
        await setup.respond(0, 5);
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        setup.publish(twoTabSnapshot(newerEntry ? "tab-1" : "tab-2", 8));
        if (newerEntry) {
          await setup.respond(1, 8);
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          newerEntry ? "terminal:pane-1b" : "region:tabs",
        );
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("archived parent suppresses strip entry hints and requests without disabling browsing", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    const archived = twoTabSnapshot("tab-1", 5);
    archived.items.find((item) => item.id === "root-1")!.archived = true;
    setup.publish(archived);
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("region:tabs")!;
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKey(" "));
    const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    expect(setup.commands).toEqual([]);
    expect(getControlHints(list)).toEqual([]);
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    await act(async () => setup.mockInput.pressKey("ARROW_RIGHT"));
    expect(setup.commands).toEqual([
      { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
    ]);
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.respond(0, 6);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const cancel of ["focus", "dialog", "item", "archive", "epoch", "disconnect"] as const) {
  test(`strip activation is cancelled by newer ${cancel} before readiness`, async () => {
    const setup = await localTabFixture();
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      act(() => setup.renderer.stdin.emit("data", Buffer.from("\x1b[C\r")));
      expect(setup.commands).toHaveLength(1);
      const ready = twoTabSnapshot("tab-2", 5);
      if (cancel === "focus") {
        act(() => {
          setup.renderer.root.findDescendantById("region:category")!.focus();
          setup.renderer.root.findDescendantById("region:tabs")!.focus();
        });
      } else if (cancel === "dialog") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        await setup.flush();
        await act(async () => setup.mockInput.pressEscape());
      } else if (cancel === "item") {
        const workspace = setup.renderer.root.findDescendantById("workspace:workspace-work")!;
        await act(async () => setup.mockMouse.click(workspace.screenX + 1, workspace.screenY));
      } else if (cancel === "archive") {
        ready.items.find((item) => item.id === "item-1")!.archived = true;
      } else if (cancel === "epoch") {
        ready.epoch = "replacement-epoch";
      } else {
        setup.connect(false);
      }
      setup.publish(ready);
      await setup.flush();
      await setup.respond();
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
      setup.connect(true);
      setup.publish({ ...ready, revision: 6 });
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const stage of ["before response", "after response"] as const) {
  for (const interaction of ["paste", "same-source pane mouse-down"] as const) {
    test(`terminal ${interaction} cancels pending tab entry ${stage} without changing bytes`, async () => {
      const setup = await localTabFixture();
      try {
        const source = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
        await setup.next();
        if (stage === "after response") {
          await setup.respond();
        }
        if (interaction === "paste") {
          act(() => source.write(new TextEncoder().encode("\x1b[?2004h")));
          await act(async () => setup.mockInput.pasteBracketedText("source-only"));
          expect(setup.received).toEqual([
            {
              paneId: "pane-1b",
              bytes: [...new TextEncoder().encode("\x1b[200~source-only\x1b[201~")],
            },
          ]);
        } else {
          await act(async () => setup.mockMouse.pressDown(source.screenX + 1, source.screenY + 1));
          expect(setup.received).toEqual([]);
        }
        expect(setup.renderer.currentFocusedRenderable === source).toBe(true);
        if (stage === "before response") {
          await setup.respond();
        }
        setup.publish(twoTabSnapshot("tab-2", 5));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        setup.publish(twoTabSnapshot("tab-2", 6));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }

  test(`terminal emulator reply preserves pending tab entry ${stage} and its response bytes`, async () => {
    const setup = await localTabFixture();
    try {
      const source = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      await setup.next();
      if (stage === "after response") {
        await setup.respond();
      }
      act(() => source.write(new TextEncoder().encode("\x1b[5n")));
      expect(setup.received).toEqual([
        { paneId: "pane-1b", bytes: [...new TextEncoder().encode("\x1b[0n")] },
      ]);
      if (stage === "before response") {
        await setup.respond();
      }
      setup.publish(twoTabSnapshot("tab-2", 5));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const order of ["response first", "snapshot first"] as const) {
  test(`terminal Hyper tab switch enters destination memory with ${order}`, async () => {
    const setup = await localTabFixture();
    try {
      const originalTerminal = setup.renderer.currentFocusedRenderable;
      await setup.previous();
      expect(setup.commands).toEqual([]);
      expect(setup.renderer.currentFocusedRenderable === originalTerminal).toBe(true);
      await setup.next();
      if (order === "response first") {
        await setup.respond();
        expect(setup.renderer.currentFocusedRenderable === originalTerminal).toBe(true);
      }
      setup.publish(twoTabSnapshot("tab-2", 5));
      await setup.flush();
      const destination = setup.renderer.root.findDescendantById("terminal:pane-2b");
      if (order === "snapshot first") {
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        await setup.respond();
      }
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
      expect(setup.renderer.currentFocusedRenderable === destination).toBe(true);
      expect(setup.commands).toEqual([
        { type: "surface.selectTab", surfaceId: "surface-1", tabId: "tab-2" },
      ]);
      await setup.previous();
      await setup.respond(1, 6);
      setup.publish(twoTabSnapshot("tab-1", 6));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("control-source Hyper preserves strip focus, mouse enters, and background snapshots preserve controls", async () => {
  const setup = await localTabFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await setup.next();
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.respond();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    const tab = setup.renderer.root.findDescendantById("tab:tab-1")!;
    await act(async () => setup.mockMouse.click(tab.screenX + 1, tab.screenY));
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.respond(1, 6);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1b");
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("tab pointer-down cancels a snapshot-first projected entry even on the same native endpoint", async () => {
  const setup = await localTabFixture();
  try {
    await setup.next();
    setup.publish(twoTabSnapshot("tab-2", 5));
    await setup.flush();
    const tab = setup.renderer.root.findDescendantById("region:tabs")!;
    await act(async () => setup.mockMouse.pressDown(tab.screenX + tab.width - 1, tab.screenY));
    expect(setup.commands).toHaveLength(1);
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("tab entry recovery clears only its own source after a deliberate successful retry", async () => {
  const setup = await localTabFixture();
  try {
    await setup.next();
    const stopped = twoTabSnapshot("tab-2", 5);
    stopped.panes
      .filter((pane) => pane.id.startsWith("pane-2"))
      .forEach((pane) => {
        pane.processStatus = "exited";
      });
    await setup.respond();
    setup.publish(stopped);
    await setup.flush();
    expect(statusText(setup)).toContain("Tab 2");
    expect(statusText(setup)).toContain("Terminal entry failed");
    // Browsing back and entering the source tab is not recovery for Tab 2.
    await setup.previous();
    await setup.respond(1, 6);
    setup.publish(twoTabSnapshot("tab-1", 6));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("j", { ctrl: true }));
    expect(statusText(setup)).toContain("Terminal entry failed");
    await setup.next();
    await setup.respond(2, 7);
    setup.publish(twoTabSnapshot("tab-2", 7));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    expect(statusText(setup)).not.toContain("Terminal entry failed");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("repeated and reversed tab requests ignore out-of-order completions", async () => {
  const setup = await localTabFixture();
  try {
    await setup.next();
    await setup.next();
    await setup.respond(1, 6);
    await setup.respond(0, 5);
    setup.publish(twoTabSnapshot("tab-2", 6));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2b");
    await setup.previous();
    setup.publish(twoTabSnapshot("tab-1", 7));
    await setup.flush();
    // Reversing from the projected tabs is browsing, not new terminal intent.
    await setup.next();
    await setup.respond(3, 8);
    await setup.respond(2, 7);
    setup.publish(twoTabSnapshot("tab-2", 8));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

function createdTabSnapshot(
  revision: number,
  status: "starting" | "running" = "running",
): Snapshot {
  const snapshot = surfaceSnapshot();
  return {
    ...snapshot,
    revision,
    surfaces: [{ ...snapshot.surfaces[0]!, activeTabId: "created-tab" }],
    tabs: [
      ...snapshot.tabs,
      {
        ...snapshot.tabs[0]!,
        id: "created-tab",
        position: 1,
        layout: { type: "pane", paneId: "created-pane" },
      },
    ],
    panes: [
      ...snapshot.panes,
      { ...snapshot.panes[0]!, id: "created-pane", processStatus: status },
    ],
  };
}

for (const [origin, order, readiness] of [
  ["terminal:pane-1", "response first", "running"],
  ["terminal:pane-1", "snapshot first", "starting"],
  ["region:tabs", "snapshot first", "running"],
  ["region:category", "response first", "starting"],
  ["region:navigator", "snapshot first", "starting"],
] as const) {
  test(`native Hyper+n from ${origin} ${order} ${readiness} enters only the created pane`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      act(() => setup.renderer.root.findDescendantById(origin)!.focus());
      await setup.flush();
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      expect(setup.commands.filter((command) => command.type.startsWith("tab."))).toEqual([
        { type: "tab.create", surfaceId: "surface-1", title: "Shell" },
      ]);
      if (order === "snapshot first") {
        await setup.publish(createdTabSnapshot(2, readiness));
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
        expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
      }
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 3,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      await setup.flush();
      if (order === "response first") {
        expect(setup.renderer.currentFocusedRenderable).toBe(source);
        await setup.publish(createdTabSnapshot(2, readiness));
      }
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
      await setup.publish(createdTabSnapshot(3, readiness));
      if (readiness === "starting") {
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
        await setup.publish(createdTabSnapshot(4));
      }
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:created-pane");
      expect(setup.commands.filter((command) => command.type === "surface.selectTab")).toEqual([]);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

test("native Hyper+n waits for exact returned pane native eligibility without entering a running sibling", async () => {
  const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
  try {
    await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
    const ready = createdTabSnapshot(2);
    ready.tabs[1]!.layout = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: { type: "pane", paneId: "decoy" },
      second: { type: "pane", paneId: "created-pane" },
    };
    ready.panes.push({ ...ready.panes[0]!, id: "decoy" });
    await setup.publish(ready);
    const target = setup.renderer.root.findDescendantById("terminal:created-pane")!;
    act(() => {
      target.visible = false;
    });
    await act(async () =>
      setup.tabCreates[0]!.resolve({
        ok: true,
        revision: 2,
        result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(setup.sent).toEqual([]);
    act(() => {
      target.visible = true;
    });
    await setup.flush();
    await act(async () => setup.mockInput.typeText("x"));
    expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
    expect(setup.renderer.currentFocusedRenderable).toBe(target);
  } finally {
    act(() => {
      setup.store.stop();
      setup.renderer.destroy();
    });
  }
});

for (const unavailable of ["tiny", "failed", "exited"] as const) {
  test(`native Hyper+n ${unavailable} destination never receives input, restarts or revives entry`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      if (unavailable === "tiny") {
        act(() => setup.resize(120, 10));
        await setup.flush();
      }
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      const ready = createdTabSnapshot(2);
      if (unavailable !== "tiny") {
        ready.panes[1]!.processStatus = unavailable;
      }
      await setup.publish(ready);
      await setup.flush();
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
      act(() => setup.resize(120, 40));
      await setup.publish(createdTabSnapshot(3));
      await setup.publish(createdTabSnapshot(4));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
      await act(async () => setup.mockInput.typeText("y"));
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

for (const cancel of ["scroll", "disconnect"] as const) {
  test(`native Hyper+n pre-response ${cancel} cancels entry permanently`, async () => {
    const initial = { ...surfaceSnapshot(), revision: 1 };
    initial.tabs.push(
      ...Array.from({ length: 10 }, (_, index) => ({
        ...initial.tabs[0]!,
        id: `other-${index}`,
        position: index + 1,
        title: `Long terminal tab ${index}`,
        layout: null,
      })),
    );
    const setup = await liveInputFixture(initial);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      if (cancel === "scroll") {
        const area = setup.renderer.root.findDescendantById(
          "region:tabs:scroller:viewport",
        ) as ScrollBoxRenderable;
        expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
        await act(async () =>
          setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
        );
      } else {
        act(() => {
          setup.store.stop();
          setup.renderCurrent();
        });
      }
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      if (cancel === "disconnect") {
        await setup.store.start();
      }
      await setup.publish(createdTabSnapshot(2));
      await setup.publish(createdTabSnapshot(3));
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

for (const transition of [
  "item archive",
  "parent archive",
  "existing tab",
  "source tab after new selection",
  "context",
] as const) {
  test(`native Hyper+n pre-response ${transition} restoration cannot rearm control-origin entry`, async () => {
    const initial = { ...surfaceSnapshot(), revision: 1 };
    initial.tabs.push({ ...initial.tabs[0]!, id: "other-tab", layout: null, position: 1 });
    const setup = await liveInputFixture(initial);
    try {
      act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
      const changed =
        transition === "source tab after new selection"
          ? createdTabSnapshot(2)
          : structuredClone(initial);
      if (transition === "source tab after new selection") {
        changed.tabs.push(initial.tabs[1]!);
      }
      changed.revision = 2;
      if (transition === "existing tab") {
        changed.surfaces[0]!.activeTabId = "other-tab";
      } else if (transition === "context") {
        changed.items = [];
      } else if (transition === "item archive" || transition === "parent archive") {
        changed.items.find(
          (item) => item.id === (transition === "item archive" ? "item-1" : "root-1"),
        )!.archived = true;
      }
      await setup.publish(changed);
      await setup.publish({
        ...(transition === "source tab after new selection" ? changed : initial),
        revision: 3,
        surfaces: initial.surfaces,
      });
      await act(async () =>
        setup.tabCreates[0]!.resolve({
          ok: true,
          revision: 4,
          result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
        }),
      );
      await setup.publish(createdTabSnapshot(4));
      await setup.publish(createdTabSnapshot(5));
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:created-pane");
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

for (const origin of ["terminal:pane-1", "region:tabs", "region:category"] as const) {
  for (const oldOrder of ["response first", "snapshot first"] as const) {
    for (const newOrder of ["response first", "snapshot first"] as const) {
      test(`overlapping successful Hyper+n from ${origin}, old ${oldOrder}, newest ${newOrder} enters only newest pane`, async () => {
        const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
        try {
          act(() => setup.renderer.root.findDescendantById(origin)!.focus());
          await setup.flush();
          const focused: (string | undefined)[] = [];
          setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, () => {
            focused.push(setup.renderer.currentFocusedRenderable?.id);
          });
          await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
          await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
          expect(setup.tabCreates).toHaveLength(2);
          const old = createdTabSnapshot(2);
          old.surfaces[0]!.activeTabId = "old-tab";
          old.tabs[1]!.id = "old-tab";
          old.tabs[1]!.layout = { type: "pane", paneId: "old-pane" };
          old.panes[1]!.id = "old-pane";
          const newest = createdTabSnapshot(4, "starting");
          newest.tabs[1]!.position = 2;
          newest.tabs.push(old.tabs[1]!);
          newest.panes.push(old.panes[1]!);
          async function respond(index: 0 | 1): Promise<void> {
            await act(async () =>
              setup.tabCreates[index]!.resolve({
                ok: true,
                revision: index === 0 ? 2 : 4,
                result:
                  index === 0
                    ? { id: "old-tab", tabId: "old-tab", paneId: "old-pane" }
                    : { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
              }),
            );
            await setup.flush();
          }
          if (oldOrder === "response first") {
            await respond(0);
          }
          if (newOrder === "response first") {
            await respond(1);
          }
          await setup.publish(old);
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();
          if (oldOrder === "snapshot first") {
            await respond(0);
          }
          await setup.publish({ ...old, revision: 3 });
          expect(setup.renderer.currentFocusedRenderable?.id).toBe(
            origin === "terminal:pane-1" ? "region:tabs" : origin,
          );
          expect(focused).not.toContain("terminal:old-pane");
          await setup.publish(newest);
          if (newOrder === "snapshot first") {
            await respond(1);
          }
          expect(focused).not.toContain("terminal:created-pane");
          expect(setup.sent).toEqual([]);
          await setup.publish({
            ...newest,
            revision: 5,
            panes: newest.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
          });
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:created-pane");
          expect(focused).not.toContain("terminal:old-pane");
          expect(setup.commands.filter((command) => command.type === "tab.create")).toEqual([
            { type: "tab.create", surfaceId: "surface-1", title: "Shell" },
            { type: "tab.create", surfaceId: "surface-1", title: "Shell" },
          ]);
          expect(setup.commands.filter((command) => command.type === "surface.selectTab")).toEqual(
            [],
          );
        } finally {
          act(() => {
            setup.store.stop();
            setup.renderer.destroy();
          });
        }
      });
    }
  }
}

for (const newer of [false, true]) {
  for (const outcome of ["failure", "cancelled success"] as const) {
    test(`native Hyper+n ${outcome} cleans its observer without removing newer intent (${newer})`, async () => {
      const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        const frames = setup.renderer.listenerCount(CliRenderEvents.FRAME);
        await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames + 1);
        if (newer) {
          await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
        }
        await act(async () => {
          if (outcome === "failure") {
            setup.tabCreates[0]!.reject(new Error("Create refused"));
          } else {
            if (!newer) {
              setup.mockInput.typeText("z");
            }
            setup.tabCreates[0]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "old-tab", tabId: "old-tab", paneId: "old-pane" },
            });
          }
        });
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames + (newer ? 1 : 0));
        if (newer) {
          await setup.publish(createdTabSnapshot(2, "starting"));
          await act(async () =>
            setup.tabCreates[1]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "created-tab", tabId: "created-tab", paneId: "created-pane" },
            }),
          );
          await setup.publish(createdTabSnapshot(3));
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([{ paneId: "created-pane", bytes: [120] }]);
          expect(statusText(setup)).not.toContain("Create refused");
        } else {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          expect(setup.sent).toEqual([]);
          if (outcome === "failure") {
            expect(statusText(setup)).toContain("Create refused");
          }
        }
      } finally {
        act(() => {
          setup.store.stop();
          setup.renderer.destroy();
        });
      }
    });
  }
}

test("a rejected tab command reports in status with a persistent tab indicator", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          if (command.type === "surface.ensure") {
            return { ok: true, revision: 1, result: { id: "surface-1" } };
          }
          throw new Error("tab failed");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("n", { hyper: true }));
  await setup.flush();

  expect(setup.renderer.root.findDescendantById("tab-error")).toBeDefined();
  expect(statusText(setup)).toContain("tab failed");
  act(() => setup.renderer.destroy());
});
