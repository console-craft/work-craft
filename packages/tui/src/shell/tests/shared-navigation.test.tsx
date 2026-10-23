import { expect, spyOn, test } from "bun:test";

import { type InputRenderable, KeyEvent, parseKeypress } from "@opentui/core";
import type { StreamConnection } from "@work-craft/server/client";
import { act } from "react";

import {
  deferred,
  liveInputFixture,
  selectedPaneSnapshot,
  splitSurfaceSnapshot,
  statusText,
} from "@/shell/tests/fixtures";
import type { TerminalMaterialRenderable } from "@/workbench/terminal-material";

async function mirroredShells() {
  const initial = splitSurfaceSnapshot();
  const b = await liveInputFixture(initial);
  const a = await liveInputFixture(initial);
  return {
    a,
    b,
    async select(paneId: string) {
      await act(async () =>
        b.store.getState().command({
          type: "session.navigate",
          sessionId: "session-work",
          target: { kind: "pane", paneId },
        }),
      );
      await b.flush();
      await a.publish(b.store.snapshot()!);
    },
    close() {
      act(() => {
        a.renderer.destroy();
        b.renderer.destroy();
      });
      a.store.stop();
      b.store.stop();
    },
  };
}

test("an admitted native key cannot borrow away-and-back navigation authority", async () => {
  const setup = await liveInputFixture();
  const native = setup.renderer.root.findDescendantById(
    "terminal:pane-1",
  ) as TerminalMaterialRenderable;
  const send = spyOn(setup.store.getState().stream!, "sendSemantic");
  try {
    const output = setup.store.getState().outputs.pane("pane-1");
    const previous = output.read()!;
    const cursor = previous.chunks.at(-1)?.cursor ?? previous.historyCursor;
    await setup.store.apply({
      type: "terminal.output",
      paneId: "pane-1",
      epoch: previous.epoch,
      runtimeGeneration: previous.runtimeGeneration,
      cursor: cursor + 5,
      data: Buffer.from("\x1b[?1h").toString("base64"),
      geometrySequence: setup.store.getState().geometry.sequence,
    });
    native.handleKeyPress(new KeyEvent(parseKeypress("\x1b[A")!));
    const current = setup.store.snapshot()!;
    await setup.store.apply({
      type: "control.snapshot",
      snapshot: {
        ...current,
        revision: current.revision + 1,
        navigation: current.navigation.map((navigation) => ({
          ...navigation,
          generation: navigation.generation + 2,
        })),
      },
    });
    setup.renderCurrent();
    await setup.flush();
    expect(send).not.toHaveBeenCalled();
    expect(setup.sent).toEqual([]);
  } finally {
    send.mockRestore();
    setup.store.stop();
    act(() => setup.renderer.destroy());
  }
});

test("remote selection follows an unobscured terminal without publishing projection as activity or navigation", async () => {
  const fixture = await mirroredShells();
  const { a } = fixture;
  try {
    await fixture.select("pane-2");
    expect(a.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    await a.publish({ ...a.store.snapshot()!, revision: 6 });
    await a.flush();
    expect(a.commands).toEqual([]);
    expect(a.sent).toEqual([]);
  } finally {
    fixture.close();
  }
});

for (const editing of ["filter", "form", "tabs", "drawer"] as const) {
  test(`remote selection preserves an editing client's focus and draft in ${editing}`, async () => {
    const fixture = await mirroredShells();
    const { a } = fixture;
    try {
      if (editing === "drawer") {
        act(() => a.resize(100, 32));
        await a.flush();
        await act(async () => a.mockInput.pressKeys(["\x00b"]));
      } else if (editing === "form") {
        act(() => a.renderer.root.findDescendantById("region:navigator")!.focus());
        await a.flush();
        await act(async () => a.mockInput.pressKey("n"));
        await a.flush();
      } else {
        act(() =>
          a.renderer.root
            .findDescendantById(editing === "filter" ? "navigator:filter" : "region:tabs")!
            .focus(),
        );
      }
      await a.flush();
      if (editing === "filter" || editing === "form") {
        await act(async () => a.mockInput.typeText("unfinished draft"));
        await a.flush();
      }
      const original = a.renderer.currentFocusedRenderable!;
      if (editing === "filter" || editing === "form") {
        expect(original.id).toMatch(/^(navigator:filter|create:path)$/);
        expect((original as InputRenderable).value).toBe("unfinished draft");
      }
      const activities = a.activities.length;
      await fixture.select("pane-2");
      expect(a.store.snapshot()!.navigation[0]?.paneId).toBe("pane-2");
      expect(a.renderer.currentFocusedRenderable).toBe(original);
      if (editing === "filter" || editing === "form") {
        expect((original as InputRenderable).value).toBe("unfinished draft");
      }
      expect(a.renderer.root.findDescendantById("status")!.screenY).toBe(a.renderer.height - 1);
      expect(statusText(a)).toContain("HINTS");
      expect(a.commands).toEqual([]);
      expect(a.activities).toHaveLength(activities);
    } finally {
      fixture.close();
    }
  });
}

for (const processStatus of ["exited", "failed"] as const) {
  test(`a remote ${processStatus} pane never enters a running sibling`, async () => {
    const fixture = await mirroredShells();
    try {
      const selected = selectedPaneSnapshot(splitSurfaceSnapshot(), "pane-2", 2);
      selected.revision = 5;
      selected.panes[1]!.processStatus = processStatus;
      await fixture.b.publish(selected);
      await fixture.a.publish(selected);
      expect(fixture.a.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      expect(fixture.a.commands).toEqual([]);
    } finally {
      fixture.close();
    }
  });
}

test("remote follow waits for the selected starting pane without losing local workbench intent", async () => {
  const fixture = await mirroredShells();
  try {
    const selected = selectedPaneSnapshot(splitSurfaceSnapshot(), "pane-2", 2);
    selected.revision = 5;
    selected.panes[1]!.processStatus = "starting";
    await fixture.b.publish(selected);
    await fixture.a.publish(selected);
    expect(fixture.a.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-2");
    const running = {
      ...selected,
      revision: 6,
      panes: selected.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
    };
    await fixture.b.publish(running);
    await fixture.a.publish(running);
    expect(fixture.a.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    expect(fixture.a.commands).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("a remote starting pane cannot steal focus after the observer deliberately returns to chrome", async () => {
  const fixture = await mirroredShells();
  try {
    const selected = selectedPaneSnapshot(splitSurfaceSnapshot(), "pane-2", 2);
    selected.revision = 5;
    selected.panes[1]!.processStatus = "starting";
    await fixture.a.publish(selected);
    act(() => fixture.a.renderer.root.findDescendantById("region:category")!.focus());
    await fixture.a.flush();
    await fixture.a.publish({
      ...selected,
      revision: 6,
      panes: selected.panes.map((pane) => ({ ...pane, processStatus: "running" as const })),
    });
    expect(fixture.a.renderer.currentFocusedRenderable?.id).toBe("region:category");
    expect(fixture.a.commands).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("registration completion cannot Open after live navigation advances before React commits", async () => {
  const a = await liveInputFixture();
  try {
    act(() => a.renderer.root.findDescendantById("region:navigator")!.focus());
    await a.flush();
    await act(async () => a.mockInput.pressKey("n"));
    await a.flush();
    await act(async () => a.mockInput.typeText("/captured/directory"));
    await act(async () => a.mockInput.pressEnter());
    const next = selectedPaneSnapshot(a.store.snapshot()!, "pane-2", 2);
    next.revision++;
    await a.publish(next, false);
    await act(async () =>
      a.registrations[0]!.resolve({
        ok: true,
        revision: next.revision,
        result: { id: "created-root", itemId: "created-root", rootItemId: "created-root" },
      }),
    );
    expect(a.commands.map(({ type }) => type)).toEqual(["directory.register"]);
  } finally {
    act(() => a.renderer.destroy());
    a.store.stop();
  }
});

test("fast terminal redraws preserve native focus when old parsed chunks exceed retention", async () => {
  const a = await liveInputFixture();
  try {
    const stream = a.store.getState().stream;
    const terminal = a.renderer.currentFocusedRenderable;
    for (const text of ["x".repeat(1_200_000), "y".repeat(1_200_000)]) {
      await act(async () => a.output(text));
      await a.flush();
      expect(a.store.getState().stream).toBe(stream);
      expect(a.renderer.currentFocusedRenderable).toBe(terminal);
      expect(a.renderer.root.findDescendantById("dialog")).toBeUndefined();
    }
  } finally {
    act(() => a.renderer.destroy());
    a.store.stop();
  }
});

test("a genuinely unread output gap repairs history without detaching or stealing terminal focus", async () => {
  const a = await liveInputFixture();
  try {
    const stream = a.store.getState().stream;
    const attachment = a.store.getState().attachment;
    const recovered = structuredClone(a.store.snapshot()!);
    const history = {
      paneId: "pane-1",
      cursor: 2_400_000,
      startCursor: 1_500_000,
      prefixBytes: 2,
      data: Buffer.from("\x1bc" + "y".repeat(900_000)).toString("base64"),
      truncated: true,
      initialSize: recovered.geometry.panes.find(({ paneId }) => paneId === "pane-1")!.size,
      initialGridSequence: 0,
      resizes: [],
    };
    a.client.paneHistory = async () => ({
      epoch: recovered.epoch,
      paneId: "pane-1",
      runtimeGeneration: 0,
      history,
    });
    await act(async () => {
      await a.output("x".repeat(1_200_000));
      await a.output("y".repeat(1_200_000));
    });
    await a.flush();
    expect(a.store.getState().stream).toBe(stream);
    expect(a.store.getState().attachment).toBe(attachment);
    a.renderCurrent();
    await a.flush();
    expect(a.renderer.root.findDescendantById("dialog")).toBeUndefined();
    expect(a.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => a.renderer.destroy());
    a.store.stop();
  }
});

test("reattaching the stream preserves active terminal focus without a transient session chooser", async () => {
  const a = await liveInputFixture();
  const pending = deferred<StreamConnection>();
  const entered = deferred<void>();
  const replacement = await a.client.stream({ onMessage() {} });
  let reconnect: Promise<void> | undefined;
  try {
    a.client.stream = async () => {
      entered.resolve();
      return pending.promise;
    };
    reconnect = a.store.reload();
    await entered.promise;
    a.renderCurrent();
    await a.flush();
    expect(a.renderer.root.findDescendantById("dialog")).toBeUndefined();
    pending.resolve(replacement);
    await reconnect;
    a.renderCurrent();
    await a.flush();
    expect(a.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    pending.resolve(replacement);
    await reconnect;
    act(() => a.renderer.destroy());
    a.store.stop();
  }
});

for (const move of ["before submit", "while submitting"] as const) {
  test(`a captured draft survives remote away-and-back ${move} without a stale Open`, async () => {
    const fixture = await mirroredShells();
    const { a } = fixture;
    try {
      act(() => a.renderer.root.findDescendantById("region:navigator")!.focus());
      await a.flush();
      await act(async () => a.mockInput.pressKey("n"));
      await a.flush();
      await act(async () => a.mockInput.typeText("/captured/directory"));
      const original = a.renderer.currentFocusedRenderable!;
      if (move === "while submitting") {
        await act(async () => a.mockInput.pressEnter());
      }
      await fixture.select("pane-2");
      await fixture.select("pane-1");
      expect(a.renderer.currentFocusedRenderable).toBe(original);
      expect((original as InputRenderable).value).toBe("/captured/directory");
      if (move === "before submit") {
        await act(async () => a.mockInput.pressEnter());
      }
      expect(a.commands).toEqual([
        {
          type: "directory.register",
          workspaceId: "workspace-shared",
          path: "/captured/directory",
        },
      ]);
      await act(async () =>
        a.registrations[0]!.resolve({
          ok: true,
          revision: 7,
          result: { id: "created-root", itemId: "created-root", rootItemId: "created-root" },
        }),
      );
      await a.flush();
      expect(a.commands).toHaveLength(1);
      expect(a.store.snapshot()!.navigation[0]?.paneId).toBe("pane-1");
      if (move === "while submitting") {
        expect(a.renderer.currentFocusedRenderable).toBe(original);
        expect((original as InputRenderable).value).toBe("/captured/directory");
      }
    } finally {
      fixture.close();
    }
  });
}
