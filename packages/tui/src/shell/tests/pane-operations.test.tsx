import { expect, test } from "bun:test";

import {
  CliRenderEvents,
  EmbeddedTerminalRenderable,
  type Renderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { type Snapshot } from "@work-craft/server/client";
import { act, type ReactNode, useState } from "react";

import type { WorkCraftState } from "@/client/store.ts";
import { WorkCraftShell } from "@/shell/shell.tsx";
import {
  liveInputFixture,
  openFixtureItem,
  splitSurfaceSnapshot,
  statusText,
  surfaceSnapshot,
  testRender,
  twoSurfaceSnapshot,
  workCraftStateFixture,
} from "@/shell/tests/fixtures";
import { isEligibleFocusTarget } from "@/ui/focus-utils";

for (const order of ["response first", "snapshot first"] as const) {
  for (const activation of ["return", "space", "mouse"] as const) {
    test(`native Reactivate ${activation}, ${order}: transfers origin before disabling and enters only its exact ready pane`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        const root = setup.renderer.root;
        const original = root.findDescendantById("terminal:pane-2")!;
        await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("reactivate:pane-2");
        const button = root.findDescendantById("reactivate:pane-2")!;
        if (activation === "mouse") {
          await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
        } else {
          await act(async () =>
            activation === "return" ? setup.mockInput.pressEnter() : setup.mockInput.pressKey(" "),
          );
        }
        await setup.flush();
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
          { type: "process.restart", paneId: "pane-2" },
        ]);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(button.focusable).toBe(false);
        expect(setup.sent).toEqual([]);
        const respond = () =>
          act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-2" } }),
          );
        const next = { ...splitSurfaceSnapshot(), revision: 5 };
        if (order === "response first") {
          await respond();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          expect(button.focusable).toBe(false);
        } else {
          await setup.publish(next);
          expect(root.findDescendantById("reactivate:pane-2")).toBeUndefined();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        }
        if (order === "response first") {
          await setup.publish(next);
        } else {
          await respond();
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
        expect(root.findDescendantById("terminal:pane-2")).toBe(original);
        expect(root.findDescendantById("terminal:pane-2")!.opacity).toBe(1);
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const change of [
  "running",
  "starting",
  "epoch",
  "disconnect",
  "active tab",
  "item archived",
  "parent archived",
  "resize",
  "drawer",
  "modal",
] as const) {
  test(`captured native Reactivate rejects precommit ${change} without restart or PTY leakage`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.panes[1]!.processStatus = "exited";
    const setup = await liveInputFixture(initial);
    try {
      const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
      expect(button).toBeDefined();
      act(() => button.focus());
      await setup.flush();
      const terminal = setup.renderer.root.findDescendantById(
        "terminal:pane-2",
      ) as EmbeddedTerminalRenderable;
      const captured = terminal.onData!;
      const capturedResize = terminal.onTerminalResize!;
      const next = structuredClone(initial);
      next.revision = 5;
      if (change === "disconnect") {
        setup.store.stop();
      } else if (change === "resize") {
        act(() => setup.resize(79, 40));
      } else if (change === "drawer") {
        await act(async () => {
          setup.resize(100, 40);
          setup.mockInput.pressKeys(["\x00b"]);
        });
      } else if (change === "modal") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      } else {
        if (change === "epoch") {
          next.epoch = "epoch-b";
        } else if (change === "active tab") {
          next.surfaces[0]!.activeTabId = "missing";
        } else if (change === "item archived" || change === "parent archived") {
          next.items.find(
            (item) => item.id === (change === "item archived" ? "item-1" : "root-1"),
          )!.archived = true;
        } else {
          next.panes[1]!.processStatus = change;
        }
        await setup.publish(next, false);
      }
      setup.resized.length = 0;
      captured(Uint8Array.of(65), "input");
      captured(Uint8Array.of(66), "response");
      capturedResize(80, 20);
      await act(async () => {
        setup.mockInput.pressEnter();
        setup.mockInput.pasteBracketedText("not PTY input");
        terminal.write(new TextEncoder().encode("\x1b[5n"));
        await setup.mockMouse.click(button.screenX + 1, button.screenY);
      });
      expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
      expect(setup.sent).toEqual([]);
      expect(setup.resized).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const stage of ["before response", "after response"] as const) {
  for (const cancellation of [
    "input",
    "paste",
    "focus",
    "modal",
    "context",
    "archive",
    "disconnect",
    "epoch",
  ] as const) {
    test(`Reactivate ${cancellation} ${stage} cancels exact-pane handoff permanently`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        if (stage === "after response") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 6, result: { id: "pane-2" } }),
          );
        }
        const next = { ...splitSurfaceSnapshot(), revision: 6 };
        if (cancellation === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancellation === "paste") {
          await act(async () => setup.mockInput.pasteBracketedText("cancel"));
        } else if (cancellation === "focus") {
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            setup.renderer.root.findDescendantById("region:tabs")!.focus();
          });
        } else if (cancellation === "modal") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        } else if (cancellation === "context") {
          const workspace = setup.renderer.root.findDescendantById("workspace:workspace-work")!;
          await act(async () => setup.mockMouse.click(workspace.screenX + 1, workspace.screenY));
        } else if (cancellation === "disconnect") {
          setup.store.stop();
          setup.renderCurrent();
          await setup.flush();
        } else if (cancellation === "epoch") {
          next.epoch = "epoch-b";
        } else {
          const archived = structuredClone(initial);
          archived.revision = 5;
          archived.items.find((item) => item.id === "root-1")!.archived = true;
          await setup.publish(archived);
        }
        await setup.publish(next);
        if (stage === "before response") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 6, result: { id: "pane-2" } }),
          );
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-2");
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("an unrelated running sibling cannot complete an exact-pane Reactivate handoff", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    const starting = structuredClone(initial);
    starting.revision = 5;
    starting.panes[1]!.processStatus = "starting";
    await setup.publish(starting);
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-2" } }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")!.opacity).toBe(1);
    const running = { ...splitSurfaceSnapshot(), revision: 6 };
    await setup.publish(running);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const cancellation of ["none", "input", "focus", "modal"] as const) {
  for (const duplicate of ["button", "leader"] as const) {
    test(`response-first restart retains command protection after ${cancellation} focus cancellation against ${duplicate}`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        if (cancellation === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancellation === "focus") {
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            setup.renderer.root.findDescendantById("region:tabs")!.focus();
          });
        } else if (cancellation === "modal") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
          await act(async () => setup.mockInput.pressEscape());
        }
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
        );
        await setup.flush();
        if (duplicate === "button") {
          await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
        } else {
          await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        }
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
          { type: "process.restart", paneId: "pane-2" },
        ]);
        expect(button.focusable).toBe(false);
        const running = { ...splitSurfaceSnapshot(), revision: 7 };
        await setup.publish(running);
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-2");
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("response-first restart releases protection only at its response revision, then permits a new explicit restart", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
    );
    await setup.flush();
    expect(button.focusable).toBe(false);
    for (const revision of [5, 6]) {
      await setup.publish({ ...initial, revision });
      expect(button.focusable).toBe(false);
      await act(async () => setup.mockInput.pressKeys(["\x00r"]));
      expect(setup.restarts).toHaveLength(1);
    }
    await setup.publish({ ...initial, revision: 7 });
    expect(button.focusable).toBe(true);
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
      { type: "process.restart", paneId: "pane-2" },
      { type: "process.restart", paneId: "pane-2" },
    ]);
    await act(async () => setup.restarts[1]!.reject(new Error("Retry refused")));
    await setup.flush();
    expect(button.focusable).toBe(true);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("restart failure releases command protection after native focus intent was cancelled", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    await act(async () => setup.restarts[0]!.reject(new Error("Cancelled request refused")));
    await setup.flush();
    expect(button.focusable).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKey(" "));
    expect(setup.restarts).toHaveLength(2);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("a later authoritative exit can reactivate again after successful restart protection catches up", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const original = setup.renderer.root.findDescendantById("terminal:pane-2");
    act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-2" } }),
    );
    await setup.publish({ ...splitSurfaceSnapshot(), revision: 5 });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    await setup.publish({ ...initial, revision: 6 });
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    expect(button.focusable).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(original);
    await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
      { type: "process.restart", paneId: "pane-2" },
      { type: "process.restart", paneId: "pane-2" },
    ]);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const transition of ["disconnect", "epoch"] as const) {
  for (const stage of ["pending response", "pending snapshot"] as const) {
    test(`restart protection clears across ${transition} with ${stage} without old cleanup releasing a newer request`, async () => {
      const initial = splitSurfaceSnapshot();
      initial.panes[1]!.processStatus = "exited";
      const setup = await liveInputFixture(initial);
      try {
        act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        if (stage === "pending snapshot") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
          );
          await setup.flush();
          expect(setup.renderer.root.findDescendantById("reactivate:pane-2")!.focusable).toBe(
            false,
          );
        }
        if (transition === "disconnect") {
          setup.store.stop();
          setup.renderCurrent();
          await setup.flush();
          await setup.store.start();
          setup.renderCurrent();
          await setup.flush();
        } else if (transition === "epoch") {
          await setup.publish({ ...initial, epoch: "epoch-b", revision: 5 });
        }
        const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
        expect(button.focusable).toBe(true);
        act(() => button.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressEnter());
        expect(setup.restarts).toHaveLength(2);
        if (stage === "pending response") {
          await act(async () =>
            setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
          );
          await setup.flush();
        }
        expect(button.focusable).toBe(false);
        await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
        expect(setup.restarts).toHaveLength(2);
        await act(async () => setup.restarts[1]!.reject(new Error("New request refused")));
        await setup.flush();
        expect(button.focusable).toBe(true);
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const outcome of ["response first", "snapshot first", "failure"] as const) {
  test(`same-epoch tab context changes retain restart protection until ${outcome} settles, then release it off-context`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.panes[1]!.processStatus = "exited";
    initial.tabs.push({
      ...initial.tabs[0]!,
      id: "other-tab",
      position: 1,
      layout: { type: "pane", paneId: "pane-3" },
    });
    initial.panes.push({ ...initial.panes[0]!, id: "pane-3" });
    const setup = await liveInputFixture(initial);
    try {
      act(() => setup.renderer.root.findDescendantById("reactivate:pane-2")!.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressEnter());
      if (outcome === "response first") {
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
        );
      }
      const away = {
        ...initial,
        surfaces: [{ ...initial.surfaces[0]!, activeTabId: "other-tab" }],
      };
      await setup.publish({ ...away, revision: 5 });
      await setup.publish({ ...initial, revision: 6 });
      const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
      expect(button.focusable).toBe(false);
      await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
      await act(async () => setup.mockInput.pressKeys(["\x00r"]));
      expect(setup.restarts).toHaveLength(1);
      await setup.publish({ ...away, revision: 7 });
      if (outcome === "snapshot first") {
        await act(async () =>
          setup.restarts[0]!.resolve({ ok: true, revision: 7, result: { id: "pane-2" } }),
        );
      } else if (outcome === "failure") {
        await act(async () => setup.restarts[0]!.reject(new Error("Off-context restart refused")));
      }
      await setup.publish({ ...initial, revision: 8 });
      const nextButton = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
      expect(nextButton.focusable).toBe(true);
      act(() => nextButton.focus());
      await setup.flush();
      await act(async () => setup.mockInput.pressEnter());
      expect(setup.restarts).toHaveLength(2);
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

test("Reactivate failure retains valid strip focus, reports once and allows retry without history replacement", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const original = setup.renderer.root.findDescendantById("terminal:pane-2");
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.restarts[0]!.reject(new Error("Reactivate refused")));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(button.focusable).toBe(true);
    expect(statusText(setup).match(/Reactivate refused/g)).toHaveLength(1);
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(original);
    expect(setup.sent).toEqual([]);
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.commands.filter((command) => command.type === "process.restart")).toHaveLength(2);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("leader restart from an exited action transfers to tabs and disables duplicate Reactivate submissions", async () => {
  const initial = splitSurfaceSnapshot();
  initial.panes[1]!.processStatus = "exited";
  const setup = await liveInputFixture(initial);
  try {
    const button = setup.renderer.root.findDescendantById("reactivate:pane-2")!;
    act(() => button.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(button.focusable).toBe(false);
    await act(async () => setup.mockMouse.click(button.screenX + 1, button.screenY));
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([
      { type: "process.restart", paneId: "pane-2" },
    ]);
    expect(setup.sent).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const status of ["exited", "failed", "interrupted"] as const) {
  for (const focused of [true, false]) {
    test(`${status} ${focused ? "focused" : "unfocused"} pane rejects captured precommit input and retains restart selection`, async () => {
      const setup = await liveInputFixture();
      try {
        const terminal = setup.renderer.root.findDescendantById(
          "terminal:pane-1",
        ) as EmbeddedTerminalRenderable;
        const stoppedId = focused ? "pane-1" : "pane-2";
        const captured = (
          setup.renderer.root.findDescendantById(
            `terminal:${stoppedId}`,
          ) as EmbeddedTerminalRenderable
        ).onData!;
        const stopped = splitSurfaceSnapshot();
        stopped.revision = 5;
        stopped.panes.find((pane) => pane.id === stoppedId)!.processStatus = status;
        await setup.publish(stopped, false);
        captured(Uint8Array.of(65), "input");
        captured(new TextEncoder().encode("\x1b[0n"), "response");
        expect(setup.sent).toEqual([]);
        await setup.publish(stopped);
        expect(setup.renderer.root.findDescendantById(`pane-alert:${stoppedId}`)).toBeDefined();
        expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          focused ? "region:tabs" : "terminal:pane-1",
        );
        if (focused) {
          await act(async () => setup.mockInput.pressKeys(["\x00r"]));
          expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
        }
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const interaction of ["pointer", "spatial"] as const) {
  for (const allStopped of [false, true]) {
    test(`${interaction} selects a non-first stopped split for exact restart (${allStopped ? "all stopped" : "running sibling"})`, async () => {
      const setup = await liveInputFixture();
      try {
        const stopped = splitSurfaceSnapshot();
        stopped.revision = 5;
        stopped.panes[1]!.processStatus = "exited";
        if (allStopped) {
          stopped.panes[0]!.processStatus = "exited";
        }
        await setup.publish(stopped);
        const terminal = setup.renderer.root.findDescendantById(
          "terminal:pane-2",
        ) as EmbeddedTerminalRenderable;
        if (interaction === "pointer") {
          await act(async () => setup.mockMouse.click(terminal.screenX + 1, terminal.screenY + 1));
        } else {
          if (allStopped) {
            // Enter the layout from tabs, then move to its second split.
            await act(async () => setup.mockInput.pressKey("j", { ctrl: true }));
          }
          await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          interaction === "spatial" ? "reactivate:pane-2" : "region:tabs",
        );
        expect(terminal.focusable).toBe(false);
        terminal.onData!(Uint8Array.of(65), "input");
        terminal.onData!(Uint8Array.of(66), "response");
        expect(setup.sent).toEqual([]);
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-2" });
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

for (const orientation of ["stacked", "side-by-side"] as const) {
  for (const backwards of [false, true]) {
    test(`${orientation} all-stopped spatial ${backwards ? "previous" : "next"} selects exact restart and preserves shell boundaries`, async () => {
      const initial = splitSurfaceSnapshot();
      if (initial.tabs[0]!.layout?.type === "split") {
        initial.tabs[0]!.layout.direction = orientation === "stacked" ? "horizontal" : "vertical";
      }
      const setup = await liveInputFixture(initial);
      try {
        const stopped = structuredClone(initial);
        stopped.revision = 5;
        stopped.panes.forEach((pane) => {
          pane.processStatus = "exited";
        });
        await setup.publish(stopped);
        const second = setup.renderer.root.findDescendantById("terminal:pane-2")!;
        if (backwards) {
          await act(async () => setup.mockMouse.click(second.screenX + 1, second.screenY + 1));
        }
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        const key = orientation === "stacked" ? (backwards ? "k" : "j") : backwards ? "h" : "l";
        await act(async () => setup.mockInput.pressKey(key, { ctrl: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          `reactivate:${backwards ? "pane-1" : "pane-2"}`,
        );
        expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({
          type: "process.restart",
          paneId: backwards ? "pane-1" : "pane-2",
        });
        // Leaving the pane layout must still reach shell controls, not cycle on tabs.
        if (!backwards) {
          const first = setup.renderer.root.findDescendantById("terminal:pane-1")!;
          await act(async () => setup.mockMouse.click(first.screenX + 1, first.screenY + 1));
        }
        await act(async () => setup.mockInput.pressKey("k", { ctrl: true }));
        await setup.flush();
        if (setup.renderer.currentFocusedRenderable?.id === "region:tabs") {
          await act(async () => setup.mockInput.pressKey("k", { ctrl: true }));
          await setup.flush();
        }
        const headerFocus = setup.renderer.currentFocusedRenderable;
        expect(headerFocus).not.toBeNull();
        expect(
          isEligibleFocusTarget(
            headerFocus!,
            setup.renderer.root.findDescendantById("shell-header")!,
          ),
        ).toBe(true);
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
        for (const id of ["pane-1", "pane-2"]) {
          const terminal = setup.renderer.root.findDescendantById(
            `terminal:${id}`,
          ) as EmbeddedTerminalRenderable;
          expect(terminal.focusable).toBe(false);
          terminal.onData!(Uint8Array.of(65), "input");
          terminal.onData!(Uint8Array.of(66), "response");
        }
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("a stopped selected pane does not steal focus from a shell control", async () => {
  const setup = await liveInputFixture();
  try {
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await setup.flush();
    const stopped = splitSurfaceSnapshot();
    stopped.revision = 5;
    stopped.panes[0]!.processStatus = "exited";
    await setup.publish(stopped);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("running terminal keeps raw Tab Shift+Tab Ctrl+C Escape double-prefix and ordinary bytes", async () => {
  const setup = await liveInputFixture();
  try {
    await act(async () => setup.mockInput.pressTab());
    await act(async () => setup.mockInput.pressTab({ shift: true }));
    await act(async () => setup.mockInput.pressKey("c", { ctrl: true }));
    await act(async () => setup.mockInput.pressEscape());
    await act(async () => setup.mockInput.pressKeys(["\x00\x00"]));
    await act(async () => setup.mockInput.pressKey("x"));
    expect(setup.sent.flatMap(({ bytes }) => bytes)).toEqual([9, 27, 91, 90, 3, 27, 0, 120]);
    expect(setup.sent.every(({ paneId }) => paneId === "pane-1")).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const order of ["response first", "snapshot first"] as const) {
  for (const outcome of [
    "success",
    "failure",
    "input",
    "paste",
    "focus",
    "dialog",
    "guard",
  ] as const) {
    test(`explicit restart ${outcome} with ${order} waits for exact running pane without stealing superseded focus`, async () => {
      const stopped = splitSurfaceSnapshot();
      stopped.panes[0]!.processStatus = "exited";
      const setup = await liveInputFixture(stopped);
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
        const running = splitSurfaceSnapshot();
        running.revision = 5;
        async function respond() {
          await act(async () => {
            if (outcome === "failure") {
              setup.restarts[0]!.reject(new Error("Restart refused"));
            } else {
              setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-1" } });
            }
          });
        }
        if (order === "response first") {
          await respond();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        }
        if (outcome === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (outcome === "paste") {
          await act(async () => setup.mockInput.pasteBracketedText("ignored"));
        } else if (outcome === "focus") {
          act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        } else if (outcome === "dialog") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
        } else if (outcome === "guard") {
          act(() => setup.resize(79, 40));
          await setup.flush();
          act(() => setup.resize(120, 40));
        }
        await setup.publish(outcome === "failure" ? { ...stopped, revision: 5 } : running);
        if (order === "snapshot first") {
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
          await respond();
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id === "terminal:pane-1").toBe(
          outcome === "success",
        );
        if (outcome === "failure") {
          expect(statusText(setup)).toContain("Restart refused");
        }
      } finally {
        act(() => setup.renderer.destroy());
        setup.store.stop();
      }
    });
  }
}

test("typing cannot renew a process failure status or churn its scroller", async () => {
  const now = Date.now;
  let clock = now();
  Date.now = () => clock;
  const failed = splitSurfaceSnapshot();
  failed.panes[0]!.processStatus = "failed";
  failed.panes[0]!.errorText = "Missing executable";
  const setup = await liveInputFixture(failed);
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    const before = statusText(setup);
    expect(before).toContain("Missing executable");
    const scroller = setup.renderer.root.findDescendantById("status-scroll:viewport");
    clock += 4000;
    await act(async () => setup.mockInput.pressKeys(["ordinary-text"]));
    await act(async () => setup.mockInput.pasteBracketedText("ordinary-paste"));
    await setup.publish({ ...failed, revision: 5 });
    expect(statusText(setup)).toBe(before);
    expect(setup.renderer.root.findDescendantById("status-scroll:viewport")).toBe(scroller);
    expect(setup.sent).toEqual([]);
    expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
    clock += 4001;
    await act(async () => setup.mockInput.pressKey("x"));
    await setup.publish({ ...failed, revision: 6 });
    expect(statusText(setup)).toContain("HINTS");
    expect(statusText(setup)).not.toContain("Missing executable");
  } finally {
    Date.now = now;
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

test("explicit restart clears its own entry failure after exact running readiness", async () => {
  const stopped = splitSurfaceSnapshot();
  stopped.panes[0]!.processStatus = "exited";
  const setup = await liveInputFixture(stopped);
  try {
    act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    await act(async () =>
      setup.restarts[0]!.resolve({ ok: true, revision: 5, result: { id: "pane-1" } }),
    );
    await setup.publish({ ...stopped, revision: 5 });
    expect(statusText(setup)).toContain("Terminal entry failed");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    await act(async () => setup.mockInput.pressKeys(["\x00r"]));
    const starting = splitSurfaceSnapshot();
    starting.revision = 6;
    starting.panes[0]!.processStatus = "starting";
    await setup.publish(starting);
    await act(async () =>
      setup.restarts[1]!.resolve({ ok: true, revision: 6, result: { id: "pane-1" } }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
    expect(statusText(setup)).toContain("Terminal entry failed");
    await setup.publish({ ...splitSurfaceSnapshot(), revision: 7 });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    expect(statusText(setup)).not.toContain("Terminal entry failed");
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const change of [
  "exited",
  "failed",
  "interrupted",
  "epoch",
  "disconnect",
  "active tab",
  "item archived",
  "parent archived",
] as const) {
  test(`native keyboard paste mouse focus-report and emulator response reject precommit ${change}`, async () => {
    const setup = await liveInputFixture();
    try {
      const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      const captured = terminal.onData!;
      const capturedResize = terminal.onTerminalResize!;
      act(() =>
        terminal.write(new TextEncoder().encode("\x1b[?1004h\x1b[?1000h\x1b[?1006h\x1b[?2004h")),
      );
      const next = splitSurfaceSnapshot();
      next.revision = 5;
      if (change === "epoch") {
        next.epoch = "epoch-b";
      } else if (change === "active tab") {
        next.surfaces[0]!.activeTabId = "other-tab";
      } else if (change === "item archived" || change === "parent archived") {
        next.items.find(
          (item) => item.id === (change === "item archived" ? "item-1" : "root-1"),
        )!.archived = true;
      } else if (change !== "disconnect") {
        next.panes[0]!.processStatus = change;
      }
      if (change === "disconnect") {
        setup.store.stop();
      } else {
        await setup.publish(next, false);
      }
      expect(setup.renderer.currentFocusedRenderable).toBe(terminal);
      setup.resized.length = 0;
      captured(Uint8Array.of(65), "input");
      captured(Uint8Array.of(66), "response");
      capturedResize(80, 20);
      await act(async () => {
        setup.mockInput.pressKey("x");
        setup.mockInput.pasteBracketedText("ignored-paste");
        terminal.blur();
        terminal.focus();
        terminal.write(new TextEncoder().encode("\x1b[5n"));
        await setup.mockMouse.click(terminal.screenX + 1, terminal.screenY + 1);
      });
      expect(setup.sent).toEqual([]);
      expect(setup.resized).toEqual([]);
      expect(setup.commands.filter((command) => command.type === "process.restart")).toEqual([]);
      if (change === "item archived" || change === "parent archived") {
        await setup.publish(next);
        captured(Uint8Array.of(67), "input");
        captured(Uint8Array.of(68), "response");
        expect(setup.sent).toEqual([]);
        expect(setup.store.snapshot()!.panes[0]!.processStatus).toBe("running");
        await setup.store.apply({
          type: "terminal.output",
          epoch: next.epoch,
          paneId: "pane-1",
          cursor: 4,
          data: Buffer.from("kept").toString("base64"),
        });
        expect(
          new TextDecoder().decode(setup.store.getState().terminals.get("pane-1")!.chunks[0]!.data),
        ).toBe("kept");
      }
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const coverage of ["dialog", "drawer", "guard", "height", "item"] as const) {
  test(`captured callbacks cannot reach the old pane after same-batch ${coverage} change`, async () => {
    const setup = await liveInputFixture(twoSurfaceSnapshot());
    try {
      const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      const captured = terminal.onData!;
      if (coverage === "drawer") {
        act(() => setup.resize(100, 40));
        await setup.flush();
      }
      await act(async () => {
        if (coverage === "dialog") {
          setup.mockInput.pressKey("s", { hyper: true });
        } else if (coverage === "drawer") {
          setup.mockInput.pressKey(" ", { ctrl: true });
          setup.mockInput.pressKey("b");
        } else if (coverage === "guard" || coverage === "height") {
          setup.resize(coverage === "guard" ? 79 : 120, coverage === "height" ? 8 : 40);
        } else {
          setup.mockInput.pressKey("j", { hyper: true });
        }
        captured(Uint8Array.of(65), "input");
        captured(Uint8Array.of(66), "response");
      });
      expect(setup.sent).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const entry of ["origin", "remembered"] as const) {
  test(`160→80 leaf shrink preserves ${entry} navigation to the usable sibling`, async () => {
    const snapshot = splitSurfaceSnapshot();
    const split = snapshot.tabs[0]!.layout!;
    if (split.type === "split") {
      split.ratio = 0.25;
    }
    const sent: string[] = [];
    const resized: string[] = [];
    const setup = await testRender(
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          stream: {
            close() {},
            sendInput: (id) => sent.push(id),
            resize: (id) => resized.push(id),
          },
        })}
      />,
      { width: 160, height: 40, kittyKeyboard: true },
    );
    try {
      await setup.flush();
      await openFixtureItem(setup);
      await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      await setup.flush();
      const root = setup.renderer.root;
      const a = root.findDescendantById("terminal:pane-1") as EmbeddedTerminalRenderable;
      const b = root.findDescendantById("terminal:pane-2") as EmbeddedTerminalRenderable;
      act(() => a.focus());
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable).toBe(a);
      expect([a.width, b.width]).toEqual([38, 114]);
      const capturedInput = a.onData!;
      sent.length = 0;
      resized.length = 0;
      act(() => {
        setup.resize(80, 40);
        capturedInput(Uint8Array.of(65), "input");
        capturedInput(Uint8Array.of(66), "response");
      });
      expect(sent).toEqual([]);
      await setup.flush();
      expect([a.width, b.width]).toEqual([18, 54]);
      expect(a.focusable).toBe(false);
      expect(b.focusable).toBe(true);
      a.onData!(Uint8Array.of(67), "input");
      a.onData!(Uint8Array.of(68), "response");
      a.onTerminalResize!(80, 20);
      expect(sent).toEqual([]);
      expect(resized).not.toContain("pane-1");
      if (entry === "remembered") {
        act(() => root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
      }
      await act(async () =>
        setup.mockInput.pressKey(entry === "origin" ? "l" : "j", { ctrl: true }),
      );
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
      b.onData!(Uint8Array.of(69), "input");
      expect(sent).toEqual(["pane-2"]);
      await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:category");
      expect(root.findDescendantById("terminal:pane-1") === a).toBe(true);
      expect(root.findDescendantById("terminal:pane-2") === b).toBe(true);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("same-batch split resize checks the bordered interior rather than stale native dimensions", async () => {
  const snapshot = splitSurfaceSnapshot();
  const split = snapshot.tabs[0]!.layout!;
  if (split.type === "split") {
    split.direction = "horizontal";
  }
  const setup = await liveInputFixture(snapshot);
  try {
    const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
    const captured = terminal.onData!;
    const capturedResize = terminal.onTerminalResize!;
    expect(terminal.height).toBeGreaterThanOrEqual(5);
    terminal.write(new TextEncoder().encode("\x1b[?1004h\x1b[?1000h\x1b[?1006h\x1b[?2004h"));
    setup.resized.length = 0;
    await act(async () => {
      setup.resize(120, 14);
      captured(Uint8Array.of(65), "input");
      captured(Uint8Array.of(66), "response");
      capturedResize(80, 20);
      setup.mockInput.pressKey("x");
      setup.mockInput.pasteBracketedText("ignored-paste");
      terminal.write(new TextEncoder().encode("\x1b[5n"));
      await setup.mockMouse.click(terminal.screenX + 1, terminal.screenY + 1);
    });
    expect(setup.sent).toEqual([]);
    expect(setup.resized).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const coverage of ["none", "dialog", "drawer"] as const) {
  test(`${coverage} overlay restoration synchronizes the latest measured PTY size`, async () => {
    const initial = splitSurfaceSnapshot();
    initial.tabs[0]!.layout = { type: "pane", paneId: "pane-1" };
    const setup = await liveInputFixture(initial);
    try {
      const terminal = setup.renderer.currentFocusedRenderable as EmbeddedTerminalRenderable;
      const capturedInput = terminal.onData!;
      if (coverage === "dialog") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      } else if (coverage === "drawer") {
        act(() => setup.resize(100, 40));
        await setup.flush();
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      }
      await setup.flush();
      setup.resized.length = 0;
      for (const [width, height] of coverage === "drawer"
        ? [
            [105, 42],
            [110, 45],
          ]
        : [
            [140, 42],
            [150, 45],
          ]) {
        act(() => setup.resize(width!, height!));
        await setup.flush();
      }
      if (coverage !== "none") {
        capturedInput(Uint8Array.of(65), "input");
        expect(setup.sent).toEqual([]);
        expect(setup.resized).toEqual([]);
        await act(async () => setup.mockInput.pressEscape());
        await setup.flush();
      }
      const cols = coverage === "drawer" ? 103 : 98;
      expect([terminal.width, terminal.height]).toEqual([cols, 38]);
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal);
      expect(setup.resized).toContainEqual({ paneId: "pane-1", cols, rows: 38 });
      setup.resized.length = 0;
      await setup.flush();
      expect(setup.resized).toEqual([]);
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const coverage of ["dialog", "drawer", "guard", "height"] as const) {
  test(`${coverage} restoration cannot refocus a terminal that stopped while covered`, async () => {
    const setup = await liveInputFixture();
    try {
      const terminal = setup.renderer.currentFocusedRenderable;
      if (coverage === "dialog") {
        await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
      } else if (coverage === "drawer") {
        act(() => setup.resize(100, 40));
        await setup.flush();
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      } else {
        act(() => setup.resize(coverage === "guard" ? 79 : 120, coverage === "height" ? 8 : 40));
      }
      await setup.flush();
      const stopped = splitSurfaceSnapshot();
      stopped.revision = 5;
      stopped.panes[0]!.processStatus = "exited";
      await setup.publish(stopped);
      if (coverage === "dialog") {
        await act(async () => setup.mockInput.pressEscape());
      } else if (coverage === "drawer") {
        await act(async () => setup.mockInput.pressKeys(["\x00b"]));
      } else {
        act(() => setup.resize(120, 40));
      }
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(terminal!);
      expect(terminal!.focusable).toBe(false);
      expect(setup.sent).toEqual([]);
      await act(async () => setup.mockInput.pressKeys(["\x00r"]));
      expect(setup.commands.at(-1)).toEqual({ type: "process.restart", paneId: "pane-1" });
    } finally {
      act(() => setup.renderer.destroy());
      setup.store.stop();
    }
  });
}

for (const direction of ["horizontal", "vertical"] as const) {
  for (const transition of ["item archive", "parent archive", "tab switch"] as const) {
    for (const order of ["response first", "snapshot first"] as const) {
      test(`native split pre-response invalidation ${direction} ${transition} ${order} cannot rearm after restore; fresh intent works`, async () => {
        const initial = { ...surfaceSnapshot(), revision: 1 };
        initial.tabs.push({ ...initial.tabs[0]!, id: "other-tab", position: 1, layout: null });
        const setup = await liveInputFixture(initial);
        try {
          act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
          await setup.flush();
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          expect(setup.commands.at(-1)).toEqual({
            type: "pane.split",
            paneId: "pane-1",
            direction,
          });
          const changed = { ...initial, revision: 2 };
          if (transition === "tab switch") {
            changed.surfaces = initial.surfaces.map((surface) => ({
              ...surface,
              activeTabId: "other-tab",
            }));
          } else {
            changed.items = initial.items.map((item) =>
              item.id === (transition === "item archive" ? "item-1" : "root-1")
                ? { ...item, archived: true }
                : item,
            );
          }
          await setup.publish(changed);
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          await setup.publish({ ...initial, revision: 3 });
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          const source = setup.renderer.root.findDescendantById("terminal:pane-1")!;
          const split = { ...splitSurfaceSnapshot(), revision: 4 };
          if (split.tabs[0]!.layout?.type === "split") {
            split.tabs[0]!.layout.direction = direction;
          }
          split.tabs.push(initial.tabs[1]!);
          if (order === "snapshot first") {
            await setup.publish(split);
          }
          await act(async () =>
            setup.splits[0]!.resolve({
              ok: true,
              revision: 4,
              result: { id: "pane-2", paneId: "pane-2" },
            }),
          );
          if (order === "response first") {
            await setup.publish(split);
          }
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([]);
          const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source);

          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          expect(setup.commands.at(-1)).toEqual({
            type: "pane.split",
            paneId: "pane-1",
            direction,
          });
          const fresh: Snapshot = {
            ...split,
            revision: 5,
            tabs: [
              {
                ...split.tabs[0]!,
                layout: {
                  type: "split",
                  direction,
                  ratio: 1 / 3,
                  first: { type: "pane", paneId: "pane-1" },
                  second: {
                    type: "split",
                    direction,
                    ratio: 0.5,
                    first: { type: "pane", paneId: "pane-2" },
                    second: { type: "pane", paneId: "pane-3" },
                  },
                },
              },
              split.tabs[1]!,
            ],
            panes: [...split.panes, { ...split.panes[0]!, id: "pane-3" }],
          };
          await act(async () =>
            setup.splits[1]!.resolve({
              ok: true,
              revision: 5,
              result: { id: "pane-3", paneId: "pane-3" },
            }),
          );
          await setup.publish(fresh);
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-3");
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source);
          expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(target);
          await act(async () => setup.mockInput.typeText("y"));
          expect(setup.sent).toEqual([{ paneId: "pane-3", bytes: [121] }]);
        } finally {
          act(() => {
            setup.store.stop();
            setup.renderer.destroy();
          });
        }
      });
    }
  }

  for (const outcome of ["failure", "cancelled success"] as const) {
    test(`native split RPC cleanup ${direction} ${outcome} from old request preserves newer pending entry`, async () => {
      const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        for (let request = 0; request < 2; request++) {
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
        }
        await act(async () => {
          if (outcome === "failure") {
            setup.splits[0]!.reject(new Error("Old split refused"));
          } else {
            setup.splits[0]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "old-pane", paneId: "old-pane" },
            });
          }
        });
        const starting = { ...splitSurfaceSnapshot(), revision: 2 };
        if (starting.tabs[0]!.layout?.type === "split") {
          starting.tabs[0]!.layout.direction = direction;
        }
        starting.panes[1]!.processStatus = "starting";
        await setup.publish(starting);
        await act(async () =>
          setup.splits[1]!.resolve({
            ok: true,
            revision: 3,
            result: { id: "pane-2", paneId: "pane-2" },
          }),
        );
        await setup.publish({
          ...starting,
          revision: 3,
          panes: starting.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
        });
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
        await act(async () => setup.mockInput.typeText("x"));
        expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
        expect(statusText(setup)).not.toContain("Old split refused");
      } finally {
        act(() => {
          setup.store.stop();
          setup.renderer.destroy();
        });
      }
    });

    test(`native split RPC cleanup ${direction} ${outcome} releases its own pre-response observer`, async () => {
      const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
      try {
        act(() => setup.renderer.root.findDescendantById("region:tabs")!.focus());
        await setup.flush();
        const frames = setup.renderer.listenerCount(CliRenderEvents.FRAME);
        await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
        await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames + 1);
        await act(async () => {
          if (outcome === "failure") {
            setup.splits[0]!.reject(new Error("Split refused"));
          } else {
            setup.mockInput.typeText("x");
            setup.splits[0]!.resolve({
              ok: true,
              revision: 2,
              result: { id: "pane-2", paneId: "pane-2" },
            });
          }
        });
        await setup.flush();
        expect(setup.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(frames);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(setup.sent).toEqual([]);
      } finally {
        act(() => {
          setup.store.stop();
          setup.renderer.destroy();
        });
      }
    });
  }
}

for (const direction of ["horizontal", "vertical"] as const) {
  test(`native split entry ${direction} waits for response revision even when a running target is already mounted`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
      const next = { ...splitSurfaceSnapshot(), revision: 2 };
      if (next.tabs[0]!.layout?.type === "split") {
        next.tabs[0]!.layout.direction = direction;
      }
      await setup.publish(next);
      const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
      expect(target.width).toBeGreaterThanOrEqual(20);
      expect(target.height).toBeGreaterThanOrEqual(5);
      await act(async () =>
        setup.splits[0]!.resolve({
          ok: true,
          revision: 3,
          result: { id: "pane-2", paneId: "pane-2" },
        }),
      );
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable).toBe(source);
      await setup.publish({ ...next, revision: 3 });
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
      expect(setup.renderer.currentFocusedRenderable).toBe(target);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });

  test(`native split entry ${direction} preserves undersized creation without later reviving entry`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
      expect(setup.commands.at(-1)).toEqual({ type: "pane.split", paneId: "pane-1", direction });
      act(() => setup.resize(80, 10));
      await setup.flush();
      await act(async () =>
        setup.splits[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "pane-2", paneId: "pane-2" },
        }),
      );
      const next = { ...splitSurfaceSnapshot(), revision: 2 };
      if (next.tabs[0]!.layout?.type === "split") {
        next.tabs[0]!.layout.direction = direction;
      }
      await setup.publish(next);
      expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source!);
      const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
      expect(target).toBeDefined();
      expect(target.focusable).toBe(false);
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([]);
      act(() => setup.resize(120, 40));
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(target);
      expect(setup.renderer.currentFocusedRenderable).not.toBe(target);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });

  test(`native split entry ${direction} retains source intent while destination native eligibility is delayed`, async () => {
    const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
    try {
      const source = setup.renderer.currentFocusedRenderable;
      await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
      await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
      const next = { ...splitSurfaceSnapshot(), revision: 2 };
      if (next.tabs[0]!.layout?.type === "split") {
        next.tabs[0]!.layout.direction = direction;
      }
      await setup.publish(next);
      const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
      // Hold the real native visibility gate across response/React ordering, then release on a frame.
      act(() => {
        target.visible = false;
      });
      expect(setup.renderer.currentFocusedRenderable).toBe(source);
      expect(source?.focusable).toBe(true);
      expect(isEligibleFocusTarget(target, setup.renderer.root)).toBe(false);
      await act(async () =>
        setup.splits[0]!.resolve({
          ok: true,
          revision: 2,
          result: { id: "pane-2", paneId: "pane-2" },
        }),
      );
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable).toBe(source);
      expect(target.focused).toBe(false);
      act(() => {
        target.visible = true;
      });
      await setup.flush();
      await act(async () => setup.mockInput.typeText("x"));
      expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
      expect(setup.renderer.currentFocusedRenderable).toBe(target);
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
  for (const order of ["response first", "snapshot first"] as const) {
    for (const readiness of ["starting", "running"] as const) {
      test(`native split entry ${direction} ${order} ${readiness} routes bytes only to the new pane`, async () => {
        const setup = await liveInputFixture({ ...surfaceSnapshot(), revision: 1 });
        try {
          const source = setup.renderer.currentFocusedRenderable;
          expect(source?.id).toBe("terminal:pane-1");
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          expect(setup.commands.at(-1)).toEqual({
            type: "pane.split",
            paneId: "pane-1",
            direction,
          });
          const starting = { ...splitSurfaceSnapshot(), revision: 3 };
          if (starting.tabs[0]!.layout?.type === "split") {
            starting.tabs[0]!.layout.direction = direction;
          }
          starting.panes[1]!.processStatus = readiness;
          if (order === "snapshot first") {
            await setup.publish({ ...surfaceSnapshot(), revision: 2 });
            await setup.publish(starting);
          }
          await act(async () =>
            setup.splits[0]!.resolve({
              ok: true,
              revision: 3,
              result: { id: "pane-2", paneId: "pane-2" },
            }),
          );
          await setup.flush();
          if (order === "response first") {
            await setup.publish({ ...surfaceSnapshot(), revision: 2 });
            await setup.publish(starting);
          }
          const target = setup.renderer.root.findDescendantById("terminal:pane-2")!;
          expect(target.focusable).toBe(readiness === "running");
          const running = {
            ...starting,
            revision: 4,
            panes: starting.panes.map((pane) => ({
              ...pane,
              processStatus: "running" as const,
            })),
          };
          await setup.publish(running);
          expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(source!);
          expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(target);
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent).toEqual([{ paneId: "pane-2", bytes: [120] }]);
          expect(setup.renderer.currentFocusedRenderable).toBe(target);
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

for (const direction of ["horizontal", "vertical"] as const) {
  for (const stage of ["before response", "after response"] as const) {
    for (const cancellation of [
      "input",
      "paste",
      "focus round trip",
      "modal",
      "tab",
      "restart",
      "archive",
      "scroll",
      "disconnect",
      "epoch",
    ] as const) {
      test(`native split cancellation ${direction} ${stage} ${cancellation} permanently supersedes entry`, async () => {
        const initial = { ...surfaceSnapshot(), revision: 1 };
        initial.tabs.push(
          ...Array.from({ length: 11 }, (_, index) => ({
            ...initial.tabs[0]!,
            id: `extra-tab-${index}`,
            title: `Other long terminal tab ${index}`,
            position: index + 1,
            layout: null,
          })),
        );
        const setup = await liveInputFixture(initial);
        try {
          const source = setup.renderer.currentFocusedRenderable;
          await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
          await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
          const starting = { ...splitSurfaceSnapshot(), revision: 2 };
          if (starting.tabs[0]!.layout?.type === "split") {
            starting.tabs[0]!.layout.direction = direction;
          }
          starting.tabs.push(...initial.tabs.slice(1));
          starting.panes[1]!.processStatus = "starting";
          const respond = async () => {
            await act(async () =>
              setup.splits[0]!.resolve({
                ok: true,
                revision: 2,
                result: { id: "pane-2", paneId: "pane-2" },
              }),
            );
            await setup.flush();
          };
          if (stage === "after response") {
            await respond();
          }
          await setup.publish(starting);
          if (cancellation === "input") {
            await act(async () => setup.mockInput.typeText("z"));
          } else if (cancellation === "paste") {
            await act(async () => setup.mockInput.pasteBracketedText("cancel"));
          } else if (cancellation === "focus round trip") {
            act(() => {
              setup.renderer.root.findDescendantById("region:category")!.focus();
              source!.focus();
            });
          } else if (cancellation === "modal") {
            await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
          } else if (cancellation === "scroll") {
            const area = setup.renderer.root.findDescendantById(
              "region:tabs:scroller:viewport",
            ) as ScrollBoxRenderable;
            expect(area.scrollWidth).toBeGreaterThan(area.viewport.width);
            await act(async () =>
              setup.mockMouse.scroll(area.viewport.screenX + 1, area.viewport.screenY, "down"),
            );
            expect(setup.renderer.currentFocusedRenderable).toBe(source);
          } else if (cancellation === "disconnect") {
            act(() => {
              setup.store.stop();
              setup.renderCurrent();
            });
          } else {
            const changed = { ...starting, revision: 3 };
            if (cancellation === "tab") {
              changed.surfaces = starting.surfaces.map((surface) => ({
                ...surface,
                activeTabId: "extra-tab-0",
              }));
            } else if (cancellation === "restart") {
              changed.panes = starting.panes.map((pane) =>
                pane.id === "pane-1" ? { ...pane, processStatus: "exited" as const } : pane,
              );
            } else if (cancellation === "archive") {
              changed.items = starting.items.map((item) =>
                item.id === "item-1" ? { ...item, archived: true } : item,
              );
            } else {
              changed.epoch = "new-epoch";
            }
            await setup.publish(changed);
          }
          if (stage === "before response") {
            await respond();
          }
          const running = {
            ...starting,
            revision: 4,
            panes: starting.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
          };
          // Restore the original context as well: cancellation must not merely postpone entry.
          await setup.publish({ ...running, revision: 3 });
          await setup.publish(running);
          await setup.publish({ ...running, revision: 5 });
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-2");
          setup.sent.length = 0;
          await act(async () => setup.mockInput.typeText("x"));
          expect(setup.sent.some(({ paneId }) => paneId === "pane-2")).toBe(false);
          if (["input", "paste", "focus round trip", "scroll"].includes(cancellation)) {
            expect(setup.renderer.currentFocusedRenderable).toBe(source);
            expect(setup.sent).toEqual([{ paneId: "pane-1", bytes: [120] }]);
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

  test(`native split entry ${direction} repeated splits retain terminal objects and route to each new pane`, async () => {
    const initial = { ...surfaceSnapshot(), revision: 1 };
    const setup = await liveInputFixture(initial);
    const terminals = new Map<string, Renderable>();
    let next = initial;
    try {
      terminals.set("pane-1", setup.renderer.currentFocusedRenderable!);
      for (const [index, paneId] of ["pane-2", "pane-3"].entries()) {
        const sourceId = index === 0 ? "pane-1" : "pane-2";
        await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
        await act(async () => setup.mockInput.pressKey(direction === "horizontal" ? "s" : "v"));
        expect(setup.commands.at(-1)).toEqual({ type: "pane.split", paneId: sourceId, direction });
        next = {
          ...next,
          revision: index + 2,
          tabs: [
            {
              ...next.tabs[0]!,
              layout: {
                type: "split",
                direction,
                ratio: index === 0 ? 0.5 : 2 / 3,
                first: next.tabs[0]!.layout!,
                second: { type: "pane", paneId },
              },
            },
          ],
          panes: [...next.panes, { ...initial.panes[0]!, id: paneId }],
        };
        if (index === 1) {
          await setup.publish(next);
        }
        await act(async () =>
          setup.splits[index]!.resolve({
            ok: true,
            revision: next.revision,
            result: { id: paneId, paneId },
          }),
        );
        if (index === 0) {
          await setup.publish(next);
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(`terminal:${paneId}`);
        for (const [id, terminal] of terminals) {
          expect(setup.renderer.root.findDescendantById(`terminal:${id}`)).toBe(terminal);
        }
        terminals.set(paneId, setup.renderer.currentFocusedRenderable!);
        setup.sent.length = 0;
        await act(async () => setup.mockInput.typeText("x"));
        expect(setup.sent).toEqual([{ paneId, bytes: [120] }]);
      }
    } finally {
      act(() => {
        setup.store.stop();
        setup.renderer.destroy();
      });
    }
  });
}

test("splitting focuses the new pane returned by the server", async () => {
  let workCraft: WorkCraftState;
  workCraft = workCraftStateFixture({
    snapshot: { ...surfaceSnapshot(), revision: 1 },
    command: async (command) => {
      if (command.type === "pane.split") {
        workCraft.snapshot = { ...splitSurfaceSnapshot(), revision: 2 };
        return {
          ok: true,
          revision: 2,
          result: { id: "pane-2", surfaceId: "surface-1", tabId: "tab-1", paneId: "pane-2" },
        };
      }
      return { ok: true, revision: 1, result: { id: "result-1" } };
    },
  });
  const setup = await testRender(<WorkCraftShell workCraft={workCraft} />, {
    width: 120,
    height: 40,
    kittyKeyboard: true,
  });
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("s"));
  await setup.flush();
  expect(setup.renderer.root.findDescendantById("terminal:pane-2")?.focused).toBe(true);
  act(() => setup.renderer.destroy());
});

test("split focus survives a response arriving before the new pane snapshot", async () => {
  let publishSnapshot!: (snapshot: Snapshot) => void;
  function Fixture(): ReactNode {
    const [snapshot, setSnapshot] = useState(() => ({ ...surfaceSnapshot(), revision: 1 }));
    publishSnapshot = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: async () => ({
            ok: true,
            revision: 2,
            result: { id: "pane-2", paneId: "pane-2" },
          }),
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const original = setup.renderer.root.findDescendantById("terminal:pane-1");
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("v"));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(original);
    act(() => publishSnapshot({ ...splitSurfaceSnapshot(), revision: 2 }));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("split focus survives an intermediate snapshot preceding its completion revision", async () => {
  let publishSnapshot!: (snapshot: Snapshot) => void;
  function Fixture(): ReactNode {
    const [snapshot, setSnapshot] = useState(() => ({ ...surfaceSnapshot(), revision: 1 }));
    publishSnapshot = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: async (command) =>
            command.type === "pane.split"
              ? { ok: true, revision: 3, result: { id: "pane-2", paneId: "pane-2" } }
              : { ok: true, revision: 1, result: { id: "surface-1" } },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("v"));
    act(() => publishSnapshot({ ...surfaceSnapshot(), revision: 2 }));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBeUndefined();
    act(() => publishSnapshot({ ...splitSurfaceSnapshot(), revision: 3 }));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a rejected pane command stays visible in the workbench region", async () => {
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) => {
          if (command.type === "surface.ensure") {
            return { ok: true, revision: 1, result: { id: "surface-1" } };
          }
          throw new Error("split failed");
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  await openFixtureItem(setup);
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey(" ", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("s"));
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("split failed");
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  act(() => setup.renderer.destroy());
});
