import { expect, test } from "bun:test";

import { InputRenderable } from "@opentui/core";
import {
  ApiError,
  type Command,
  type CommandResponse,
  type Snapshot,
} from "@work-craft/server/client";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { WorkCraftShell } from "@/shell/shell.tsx";
import {
  deferred,
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
import { snapshotFixture } from "@/tests/support/fixtures.ts";

for (const createKind of ["directory", "generic-root"] as const) {
  for (const order of ["snapshot first", "response first"] as const) {
    test(`first ${createKind} creation closes its form with ${order}`, async () => {
      const category = createKind === "directory" ? "implementation" : "design";
      const inputId = createKind === "directory" ? "create:path" : "create:title";
      const value = createKind === "directory" ? "/work/New root" : "New root";
      const initial = snapshotFixture({
        revision: 1,
        navigation: [{ ...snapshotFixture().navigation[0]!, generation: 1, category }],
        sessions: [{ id: "session-work", name: "Work", position: 0 }],
        categories: [
          { workspaceId: "workspace-shared", kind: category, title: category, position: 0 },
        ],
        items: [],
      });
      const created =
        createKind === "directory"
          ? {
              ...snapshotFixture().items[0]!,
              id: "new-root",
              title: "New root",
              data: {
                path: value,
                branch: null,
                availability: "available" as const,
                isGitCheckout: false,
                gitCommonDir: null,
              },
            }
          : {
              ...snapshotFixture().items[0]!,
              id: "new-root",
              title: value,
              category: "design" as const,
              kind: "generic" as const,
              data: {},
            };
      const surface = surfaceSnapshot();
      const ready: Snapshot = {
        ...initial,
        revision: 3,
        navigation: [
          {
            ...initial.navigation[0]!,
            generation: 3,
            itemId: "new-root",
            tabId: "tab-1",
            paneId: "pane-1",
          },
        ],
        items: [created],
        surfaces: [{ ...surface.surfaces[0]!, itemId: "new-root" }],
        tabs: surface.tabs,
        panes: surface.panes,
      };
      const response = deferred<CommandResponse>();
      const opened = deferred<CommandResponse>();
      const sent: Command[] = [];
      let publish!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState(initial);
        publish = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                if (
                  command.type === "session.navigate" &&
                  command.target.kind === "category" &&
                  command.target.category === category
                ) {
                  return Promise.resolve({
                    ok: true,
                    revision: snapshot.revision,
                    result: { id: "session-work", navigation: snapshot.navigation[0] },
                  });
                }
                sent.push(command);
                return command.type === "session.openItem" ? opened.promise : response.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressEnter());
        await act(async () => setup.mockInput.pressKey("n"));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(inputId);
        await act(async () => setup.mockInput.typeText(value));
        await act(async () => setup.mockInput.pressEnter());
        expect(sent).toHaveLength(1);
        if (order === "snapshot first") {
          act(() =>
            publish({
              ...initial,
              revision: 2,
              items: [created],
              navigation: [{ ...initial.navigation[0]!, generation: 2, itemId: "new-root" }],
            }),
          );
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe(inputId);
        }
        await act(async () =>
          response.resolve({
            ok: true,
            revision: 2,
            result: {
              id: "new-root",
              itemId: "new-root",
              rootItemId: "new-root",
              navigation: { ...initial.navigation[0]!, generation: 2, itemId: "new-root" },
            },
          }),
        );
        await setup.flush();
        expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
        expect(sent[1]).toEqual({
          type: "session.openItem",
          sessionId: "session-work",
          itemId: "new-root",
          navigationGeneration: 2,
        });
        if (order === "snapshot first") {
          act(() => publish(ready));
          await setup.flush();
        }
        await act(async () =>
          opened.resolve({
            ok: true,
            revision: 3,
            result: { id: "surface-1", navigation: ready.navigation[0] },
          }),
        );
        if (order === "response first") {
          act(() => publish(ready));
          await setup.flush();
        }
        expect(setup.renderer.root.findDescendantById("navigator-row:new-root")).toBeDefined();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
        expect(sent).toEqual([
          createKind === "directory"
            ? { type: "directory.register", workspaceId: "workspace-shared", path: value }
            : {
                type: "item.create",
                workspaceId: "workspace-shared",
                category: "design",
                title: value,
              },
          {
            type: "session.openItem",
            sessionId: "session-work",
            itemId: "new-root",
            navigationGeneration: 2,
          },
        ]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

for (const kind of ["new-linked", "duplicate-linked", "generic-child"] as const) {
  for (const order of ["response first", "snapshot first"] as const) {
    for (const query of ["", "no match"] as const) {
      if (kind === "generic-child" && query) {
        continue;
      }
      test(`${kind} creation enters exact child with ${order}, query=${query}`, async () => {
        const generic = kind === "generic-child";
        const duplicate = kind === "duplicate-linked";
        const base = surfaceSnapshot();
        const items: Snapshot["items"] = generic
          ? base.items.map((item) => ({ ...item, category: "design", kind: "generic", data: {} }))
          : base.items;
        const ready: Snapshot = {
          ...base,
          revision: 3,
          navigation: [
            {
              ...base.navigation[0]!,
              category: generic ? "design" : "implementation",
              generation: duplicate ? 1 : generic ? 2 : 3,
            },
          ],
          items,
          categories: [
            {
              workspaceId: "workspace-shared",
              kind: generic ? "design" : "implementation",
              title: "Work",
              position: 0,
            },
          ],
        };
        const initial: Snapshot = duplicate
          ? { ...ready, revision: 1 }
          : {
              ...ready,
              revision: 1,
              navigation: [
                {
                  ...ready.navigation[0]!,
                  generation: 1,
                  itemId: generic ? "root-1" : null,
                  tabId: null,
                  paneId: null,
                },
              ],
              items: kind === "new-linked" ? [] : [items[0]!],
              surfaces: [],
              tabs: [],
              panes: [],
            };
        const response = deferred<CommandResponse>();
        const opened = deferred<CommandResponse>();
        const commands: Command[] = [];
        let publish!: Dispatch<SetStateAction<Snapshot>>;
        function Fixture() {
          const [snapshot, setSnapshot] = useState(initial);
          publish = setSnapshot;
          return (
            <WorkCraftShell
              workCraft={workCraftStateFixture({
                snapshot,
                command: (command) => {
                  if (
                    (command.type === "session.navigate" && command.target.kind === "category") ||
                    (command.type === "session.step" && command.level === "item")
                  ) {
                    return Promise.resolve({
                      ok: true,
                      revision: snapshot.revision,
                      result: { id: "session-work", navigation: snapshot.navigation[0] },
                    });
                  }
                  commands.push(command);
                  return command.type === "session.openItem" ? opened.promise : response.promise;
                },
              })}
            />
          );
        }
        const setup = await testRender(<Fixture />, {
          width: 120,
          height: 40,
          kittyKeyboard: true,
        });
        try {
          await setup.flush();
          act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
          await act(async () => setup.mockInput.pressEnter());
          if (duplicate) {
            await act(async () => setup.mockInput.pressKey("l"));
            await act(async () => setup.mockInput.pressKey("j", { hyper: true }));
            await setup.flush();
            commands.length = 0;
          }
          const originalTerminal = setup.renderer.root.findDescendantById("terminal:pane-1");
          if (query) {
            act(() => setup.renderer.root.findDescendantById("navigator:filter")!.focus());
            await act(async () => setup.mockInput.typeText(query));
            act(() => setup.renderer.root.findDescendantById("region:navigator")!.focus());
          }
          if (generic) {
            await act(async () => setup.mockInput.pressKeys(["\x00n"]));
          } else {
            await act(async () => setup.mockInput.pressKey("n"));
          }
          await setup.flush();
          const value = generic ? "Child" : "/work/linked";
          await act(async () => setup.mockInput.typeText(value));
          await act(async () => setup.mockInput.pressEnter());
          expect(commands).toHaveLength(1);
          if (order === "snapshot first") {
            act(() =>
              publish(
                duplicate
                  ? ready
                  : {
                      ...initial,
                      revision: 2,
                      items,
                      navigation: [
                        {
                          ...initial.navigation[0]!,
                          generation: generic ? 1 : 2,
                          itemId: "root-1",
                        },
                      ],
                    },
              ),
            );
            await setup.flush();
          }
          await act(async () =>
            response.resolve({
              ok: true,
              revision: 2,
              result: {
                id: "item-1",
                itemId: "item-1",
                rootItemId: "root-1",
                navigation: {
                  ...initial.navigation[0]!,
                  generation: kind === "new-linked" ? 2 : 1,
                  itemId: duplicate ? "item-1" : "root-1",
                },
              },
            }),
          );
          await setup.flush();
          expect(commands.map(({ type }) => type)).toEqual([
            generic ? "item.create" : "directory.register",
            "session.openItem",
          ]);
          expect(commands[1]).toEqual({
            type: "session.openItem",
            sessionId: "session-work",
            itemId: "item-1",
            navigationGeneration: kind === "new-linked" ? 2 : 1,
          });
          expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
          if (order === "snapshot first") {
            act(() => publish(ready));
            await setup.flush();
          }
          await act(async () =>
            opened.resolve({
              ok: true,
              revision: 3,
              result: { id: "surface-1", navigation: ready.navigation[0] },
            }),
          );
          if (order === "response first") {
            act(() => publish(ready));
          }
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
          expect(
            (setup.renderer.root.findDescendantById("navigator:filter") as InputRenderable).value,
          ).toBe(query);
          if (originalTerminal) {
            expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBe(
              originalTerminal,
            );
          }
          if (!query) {
            expect(setup.renderer.root.findDescendantById("navigator-row:item-1")).toBeDefined();
          }
        } finally {
          act(() => setup.renderer.destroy());
        }
      });
    }
  }
}

for (const width of [120, 100]) {
  for (const outcome of [
    "running",
    "starting",
    "exited",
    "ensure failure",
    "missing surface",
    "missing target",
    "undersized",
  ] as const) {
    test(`creation entry ${outcome} at width ${width} keeps successful metadata and drawer policy`, async () => {
      const ready = { ...surfaceSnapshot(), revision: 3 };
      ready.navigation[0]!.generation = 2;
      const initial = {
        ...ready,
        revision: 1,
        surfaces: [],
        tabs: [],
        panes: [],
        navigation: [{ ...ready.navigation[0]!, generation: 1, tabId: null, paneId: null }],
      };
      if (outcome === "starting" || outcome === "exited") {
        ready.panes[0]!.processStatus = outcome;
      }
      if (outcome === "missing surface") {
        ready.surfaces = [];
        ready.tabs = [];
        ready.panes = [];
      }
      if (outcome === "missing target") {
        ready.items = [ready.items[0]!];
        ready.surfaces = [];
        ready.tabs = [];
        ready.panes = [];
      }
      const response = deferred<CommandResponse>();
      const opened = deferred<CommandResponse>();
      const commands: Command[] = [];
      let publish!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(initial);
        publish = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                if (command.type === "session.navigate" && command.target.kind === "category") {
                  return Promise.resolve({
                    ok: true,
                    revision: snapshot.revision,
                    result: { id: "session-work", navigation: snapshot.navigation[0] },
                  });
                }
                commands.push(command);
                return command.type === "session.openItem" ? opened.promise : response.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, {
        width,
        height: outcome === "undersized" ? 7 : 40,
        kittyKeyboard: true,
      });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressEnter());
        await act(async () => setup.mockInput.pressKey("n"));
        await setup.flush();
        await act(async () => setup.mockInput.typeText("/work/linked"));
        await act(async () => setup.mockInput.pressEnter());
        await act(async () =>
          response.resolve({
            ok: true,
            revision: 2,
            result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
          }),
        );
        await setup.flush();
        expect(commands.map(({ type }) => type)).toEqual([
          "directory.register",
          "session.openItem",
        ]);
        expect(setup.renderer.root.findDescendantById("dialog")).toBeUndefined();
        if (outcome === "ensure failure") {
          await act(async () => opened.reject(new Error("Cannot open requested checkout")));
        } else {
          await act(async () =>
            opened.resolve({
              ok: true,
              revision: 3,
              result: { id: "surface-1", navigation: ready.navigation[0] },
            }),
          );
        }
        act(() => publish(ready));
        await setup.flush();
        if (outcome === "starting") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
          expect(statusText(setup)).not.toContain("failed");
          act(() =>
            publish({ ...ready, panes: [{ ...ready.panes[0]!, processStatus: "running" }] }),
          );
          await setup.flush();
        }
        if (outcome === "running" || outcome === "starting") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
        } else {
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
          expect(statusText(setup)).toContain("failed");
          expect(statusText(setup)).not.toContain("directory.register failed");
          if (width === 100) {
            expect(setup.renderer.root.findDescendantById("region:navigator")?.focusable).toBe(
              true,
            );
          }
          // Later readiness must not resurrect a failed entry.
          act(() => publish({ ...surfaceSnapshot(), revision: 4 }));
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
        }
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

for (const stage of ["registration", "ensure", "readiness"] as const) {
  for (const cancel of [
    "input",
    "native leave-and-return",
    "pointer press",
    "disclosure press",
    "form cancellation",
    "replacement",
    "context",
    "epoch",
    "guard",
    "hide",
    "archive",
  ] as const) {
    if ((cancel === "form cancellation" || cancel === "replacement") && stage !== "registration") {
      continue;
    }
    if ((cancel === "pointer press" || cancel === "disclosure press") && stage === "registration") {
      continue;
    }
    test(`creation ${stage} is cancelled by ${cancel} without stale entry`, async () => {
      const ready = { ...surfaceSnapshot(), revision: 3 };
      ready.navigation[0]!.generation = 2;
      const initial = {
        ...ready,
        revision: 1,
        surfaces: [],
        tabs: [],
        panes: [],
        navigation: [{ ...ready.navigation[0]!, generation: 1, tabId: null, paneId: null }],
      };
      const response = deferred<CommandResponse>();
      const opened = deferred<CommandResponse>();
      const commands: Command[] = [];
      let publish!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(initial);
        publish = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                if (command.type === "session.navigate" && command.target.kind === "category") {
                  return Promise.resolve({
                    ok: true,
                    revision: snapshot.revision,
                    result: { id: "session-work", navigation: snapshot.navigation[0] },
                  });
                }
                commands.push(command);
                return command.type === "session.openItem" ? opened.promise : response.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressEnter());
        await act(async () => setup.mockInput.pressKey("n"));
        await setup.flush();
        await act(async () => setup.mockInput.typeText("/work/linked"));
        await act(async () => setup.mockInput.pressEnter());
        const registered: CommandResponse = {
          ok: true,
          revision: 2,
          result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
        };
        if (stage !== "registration") {
          await act(async () => response.resolve(registered));
          await setup.flush();
        }
        if (stage === "readiness") {
          await act(async () =>
            opened.resolve({
              ok: true,
              revision: 3,
              result: { id: "surface-1", navigation: ready.navigation[0] },
            }),
          );
          act(() =>
            publish({ ...ready, panes: [{ ...ready.panes[0]!, processStatus: "starting" }] }),
          );
          await setup.flush();
        }
        let final = ready;
        if (cancel === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancel === "native leave-and-return") {
          const origin = setup.renderer.currentFocusedRenderable!;
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            origin.focus();
          });
        } else if (cancel === "pointer press" || cancel === "disclosure press") {
          const row = setup.renderer.root.findDescendantById("navigator-row:root-1")!;
          await act(async () =>
            setup.mockMouse.pressDown(
              row.screenX + (cancel === "pointer press" ? 8 : 2),
              row.screenY,
            ),
          );
          await act(async () => setup.mockMouse.release(0, 0));
        } else if (cancel === "form cancellation" || cancel === "replacement") {
          await act(async () => setup.mockInput.pressEscape());
          if (cancel === "replacement") {
            await act(async () => setup.mockInput.pressKey("n"));
            await setup.flush();
            await act(async () => setup.mockInput.typeText("/work/replacement"));
          }
        } else if (cancel === "context") {
          final = {
            ...ready,
            navigation: [
              {
                ...ready.navigation[0]!,
                generation: 3,
                category: "design",
                itemId: null,
                tabId: null,
                paneId: null,
              },
            ],
            categories: [
              { workspaceId: "workspace-shared", kind: "design", title: "Design", position: 0 },
            ],
          };
        } else if (cancel === "epoch") {
          final = { ...ready, epoch: "replacement-epoch" };
        } else if (cancel === "guard") {
          act(() => setup.resize(79, 40));
        } else if (cancel === "hide") {
          await act(async () => setup.mockInput.pressKeys(["\x00b"]));
        } else {
          final = { ...ready, items: ready.items.map((item) => ({ ...item, archived: true })) };
        }
        act(() => publish(final));
        await setup.flush();
        await act(async () => response.resolve(registered));
        await act(async () =>
          opened.resolve({
            ok: true,
            revision: 3,
            result: { id: "surface-1", navigation: ready.navigation[0] },
          }),
        );
        await setup.flush();
        if (cancel === "guard") {
          act(() => setup.resize(120, 40));
          await setup.flush();
        }
        expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("terminal:pane-1");
        if (stage === "registration") {
          expect(commands).toHaveLength(1);
        }
        if (cancel === "replacement") {
          expect(
            (setup.renderer.root.findDescendantById("create:path") as InputRenderable).value,
          ).toBe("/work/replacement");
        }
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("generic child creation from a native terminal enters the new child's terminal", async () => {
  const base = surfaceSnapshot();
  const initial: Snapshot = {
    ...base,
    navigation: [{ ...base.navigation[0]!, category: "design" }],
    items: base.items.map((item) => ({ ...item, category: "design", kind: "generic", data: {} })),
    categories: [{ workspaceId: "workspace-shared", kind: "design", title: "Design", position: 0 }],
  };
  const response = deferred<CommandResponse>();
  const opened = deferred<CommandResponse>();
  const commands: Command[] = [];
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(initial);
    publish = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: (command) => {
            commands.push(command);
            return command.type === "session.openItem" ? opened.promise : response.promise;
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    act(() => setup.renderer.root.findDescendantById("terminal:pane-1")!.focus());
    await setup.flush();
    commands.length = 0;
    await act(async () => setup.mockInput.pressKeys(["\x00n"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["New child\r"]));
    expect(commands).toEqual([
      {
        type: "item.create",
        workspaceId: "workspace-shared",
        category: "design",
        title: "New child",
        parentId: "root-1",
      },
    ]);
    await act(async () => response.resolve({ ok: true, revision: 5, result: { id: "new-child" } }));
    await setup.flush();
    expect(commands[1]).toEqual({
      type: "session.openItem",
      sessionId: "session-work",
      itemId: "new-child",
      navigationGeneration: 1,
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    const navigation = {
      ...initial.navigation[0]!,
      generation: 2,
      itemId: "new-child",
      tabId: "tab-2",
      paneId: "pane-2",
    };
    await act(async () =>
      opened.resolve({ ok: true, revision: 6, result: { id: "surface-2", navigation } }),
    );
    act(() =>
      publish({
        ...initial,
        revision: 6,
        navigation: [navigation],
        items: [...initial.items, { ...initial.items[1]!, id: "new-child" }],
        surfaces: [...initial.surfaces, { id: "surface-2", itemId: "new-child" }],
        tabs: [
          ...initial.tabs,
          {
            ...initial.tabs[0]!,
            id: "tab-2",
            surfaceId: "surface-2",
            layout: { type: "pane", paneId: "pane-2" },
          },
        ],
        panes: [...initial.panes, { ...initial.panes[0]!, id: "pane-2", surfaceId: "surface-2" }],
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a newer registration supersedes the old form without blocking its own terminal entry", async () => {
  const first = deferred<CommandResponse>();
  const second = deferred<CommandResponse>();
  const opened = deferred<CommandResponse>();
  const commands: Command[] = [];
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState({
      ...surfaceSnapshot(),
      revision: 1,
      surfaces: [],
      tabs: [],
      panes: [],
      navigation: [{ ...surfaceSnapshot().navigation[0]!, tabId: null, paneId: null }],
    } as Snapshot);
    publish = setSnapshot;
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: (command) => {
            if (command.type === "session.navigate" && command.target.kind === "category") {
              return Promise.resolve({
                ok: true,
                revision: snapshot.revision,
                result: { id: "session-work", navigation: snapshot.navigation[0] },
              });
            }
            commands.push(command);
            return command.type === "session.openItem"
              ? opened.promise
              : commands.length === 1
                ? first.promise
                : second.promise;
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    for (const path of ["/work/old", "/work/new"]) {
      await act(async () => setup.mockInput.pressKey("n"));
      await setup.flush();
      await act(async () => setup.mockInput.typeText(path));
      await act(async () => setup.mockInput.pressEnter());
      if (path === "/work/old") {
        await act(async () => setup.mockInput.pressEscape());
      }
    }
    await act(async () =>
      first.resolve({
        ok: true,
        revision: 2,
        result: { id: "root-1", itemId: "root-1", rootItemId: "root-1" },
      }),
    );
    await setup.flush();
    expect(commands).toHaveLength(2);
    expect((setup.renderer.root.findDescendantById("create:path") as InputRenderable).value).toBe(
      "/work/new",
    );
    await act(async () =>
      second.resolve({
        ok: true,
        revision: 3,
        result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
      }),
    );
    expect(commands[2]).toEqual({
      type: "session.openItem",
      sessionId: "session-work",
      itemId: "item-1",
      navigationGeneration: 1,
    });
    const ready = { ...surfaceSnapshot(), revision: 4 };
    ready.navigation[0]!.generation = 2;
    await act(async () =>
      opened.resolve({
        ok: true,
        revision: 4,
        result: { id: "surface-1", navigation: ready.navigation[0] },
      }),
    );
    act(() => publish(ready));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a cancelled ensure failure cannot report status over a replacement form", async () => {
  const opened = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: (command) =>
          command.type === "session.openItem"
            ? opened.promise
            : Promise.resolve({
                ok: true,
                revision: 4,
                result: { id: "item-1", itemId: "item-1", rootItemId: "root-1" },
              }),
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["/work/linked\r"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("create:path");
    await act(async () => opened.reject(new Error("Obsolete entry failure")));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(input!);
    expect(statusText(setup)).not.toContain("Obsolete entry failure");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("directory validation retry retains edited input and deduplicates buffered submits", async () => {
  const response = deferred<CommandResponse>();
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        command: (command) => {
          if (command.type === "session.navigate" && command.target.kind === "category") {
            return Promise.resolve({ ok: true, revision: 1, result: { id: "session-work" } });
          }
          commands.push(command);
          return response.promise;
        },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKey("n"));
    await setup.flush();
    const input = setup.renderer.root.findDescendantById("create:path") as InputRenderable;
    await act(async () => setup.mockInput.pressKeys(["/work/linkedX\x08\t\r\r"]));
    expect(commands).toEqual([
      { type: "directory.register", workspaceId: "workspace-shared", path: "/work/linked" },
    ]);
    await act(async () => response.reject(new ApiError("Invalid checkout path", "path")));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("create:path")).toBe(input);
    expect(input.value).toBe("/work/linked");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("create:submit");
    expect(setup.captureCharFrame()).toContain("Invalid checkout path");
    expect(statusText(setup)).not.toContain("directory.register failed");
    await act(async () => setup.mockInput.pressEnter());
    expect(commands).toHaveLength(2);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const order of ["response first", "snapshot first"] as const) {
  for (const remembered of [false, true]) {
    test(`tab entry retains the shared ${remembered ? "remembered" : "first"} pane when its local viewport is tiny with ${order}`, async () => {
      const setup = await localTabFixture(remembered);
      try {
        await setup.next();
        const ready = twoTabSnapshot("tab-2", 5, 2, remembered ? "b" : "a");
        const layout = ready.tabs[1]!.layout!;
        if (layout.type === "split") {
          layout.ratio = remembered ? 0.9 : 0.1;
        }
        if (order === "response first") {
          await setup.respond();
        }
        setup.publish(ready);
        await setup.flush();
        if (order === "snapshot first") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
          await setup.respond();
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        expect(statusText(setup)).toContain("Terminal layout is too small");
        expect(setup.commands).toEqual([
          { type: "session.step", sessionId: "session-work", level: "tab", direction: 1 },
        ]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("item entry cannot change shared selection just because its local first pane is tiny", async () => {
  const snapshot = splitSurfaceSnapshot();
  const layout = snapshot.tabs[0]!.layout!;
  if (layout.type === "split") {
    layout.ratio = 0.1;
  }
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    expect(snapshot.navigation[0]?.paneId).toBe("pane-1");
    expect(statusText(setup)).toContain("Terminal layout is too small");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const remembered of ["stopped", "missing"] as const) {
  test(`tab entry respects daemon selection after ${remembered} pane memory`, async () => {
    const setup = await localTabFixture();
    try {
      await setup.next();
      const ready = twoTabSnapshot("tab-2", 5);
      if (remembered === "stopped") {
        ready.panes.find((pane) => pane.id === "pane-2b")!.processStatus = "exited";
      } else {
        ready.panes = ready.panes.filter((pane) => pane.id !== "pane-2b");
        ready.tabs[1]!.layout = { type: "pane", paneId: "pane-2a" };
        ready.navigation[0]!.paneId = "pane-2a";
      }
      setup.publish(ready);
      await setup.respond(0, 5, remembered === "missing" ? "pane-2a" : "pane-2b");
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        remembered === "missing" ? "terminal:pane-2a" : "region:tabs",
      );
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const destination of [
  "starting",
  "stopped",
  "empty",
  "missing tab",
  "missing panes",
  "undersized",
] as const) {
  test(`tab entry handles ${destination} without choosing another tab or reviving failed entry`, async () => {
    const setup = await localTabFixture();
    try {
      await setup.next();
      const ready = twoTabSnapshot("tab-2", 5);
      if (destination === "starting" || destination === "stopped") {
        for (const pane of ready.panes.filter((pane) => pane.id.startsWith("pane-2"))) {
          pane.processStatus = destination === "starting" ? "starting" : "exited";
        }
      } else if (destination === "empty") {
        ready.tabs[1]!.layout = null;
      } else if (destination === "missing tab") {
        ready.tabs = ready.tabs.slice(0, 1);
      } else if (destination === "missing panes") {
        ready.panes = ready.panes.filter((pane) => !pane.id.startsWith("pane-2"));
      } else {
        const layout = ready.tabs[1]!.layout!;
        if (layout.type === "split") {
          layout.ratio = 0.9999;
        }
        ready.panes.find((pane) => pane.id === "pane-2a")!.processStatus = "exited";
      }
      await setup.respond();
      setup.publish(ready);
      await setup.flush();
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
      if (destination === "stopped") {
        await act(async () => setup.mockInput.pressKeys(["\x00r"]));
        expect(setup.commands.at(-1)).toEqual({
          type: "process.restart",
          paneId: "pane-2b",
          activation: { sessionId: "session-work", generation: 5 },
        });
      }
      if (destination !== "starting") {
        expect(statusText(setup)).toContain("Terminal entry failed");
      }
      const running = twoTabSnapshot("tab-2", 6);
      running.navigation[0]!.generation = 5;
      setup.publish(running);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        destination === "starting" ? "terminal:pane-2b" : "region:tabs",
      );
      expect(setup.commands.filter((command) => command.type === "session.step")).toHaveLength(1);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

for (const stage of [
  "before response",
  "after response",
  "snapshot first",
  "create before response",
] as const) {
  for (const cancel of [
    "input",
    "native leave-and-return",
    "dialog",
    "drawer",
    "guard",
    "context",
    "epoch",
  ] as const) {
    test(`local tab entry cancels on ${cancel} ${stage}`, async () => {
      const setup =
        stage === "create before response"
          ? await localTabFixture(false, 1, true)
          : await localTabFixture();
      try {
        await setup.next();
        if (stage === "after response") {
          await setup.respond();
        }
        if (stage === "snapshot first") {
          setup.publish(twoTabSnapshot("tab-2", 5));
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:tabs");
        }
        if (cancel === "input") {
          await act(async () => setup.mockInput.pressKey("x"));
        } else if (cancel === "native leave-and-return") {
          const origin = setup.renderer.currentFocusedRenderable!;
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            origin.focus();
          });
        } else if (cancel === "dialog") {
          await act(async () => setup.mockInput.pressKey("s", { hyper: true }));
          await act(async () => setup.mockInput.pressEscape());
        } else if (cancel === "drawer") {
          act(() => setup.resize(100, 40));
          await setup.flush();
          await act(async () => setup.mockInput.pressKeys(["\x00b"]));
        } else if (cancel === "guard") {
          act(() => setup.resize(79, 40));
          await setup.flush();
          act(() => setup.resize(120, 40));
        } else if (cancel === "context") {
          const workspace = setup.renderer.root.findDescendantById("workspace:workspace-work")!;
          await act(async () => setup.mockMouse.click(workspace.screenX + 1, workspace.screenY));
          await setup.flush();
          expect(setup.renderer.root.findDescendantById("terminal:pane-1b")).toBeUndefined();
        }
        const ready = twoTabSnapshot("tab-2", 6);
        if (cancel === "epoch") {
          ready.epoch = "epoch-replaced";
        }
        if (cancel === "epoch") {
          setup.publish(ready);
          await setup.flush();
        }
        if (stage !== "after response") {
          await setup.respond();
        }
        setup.publish(ready);
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
        setup.publish({ ...ready, revision: 7 });
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).not.toMatch(/^terminal:/);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("item Enter enters and restores a remembered active-tab pane without remounting it", async () => {
  const setup = await liveInputFixture();
  try {
    await setup.flush();
    await openFixtureItem(setup);
    const row = setup.renderer.root.findDescendantById("navigator-row:item-1")!;
    await act(async () => setup.mockMouse.click(row.screenX + 8, row.screenY));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await setup.flush();
    const remembered = setup.renderer.currentFocusedRenderable;
    expect(remembered?.id).toBe("terminal:pane-2");
    await act(async () => setup.mockInput.pressKey("k", { ctrl: true }));
    await act(async () => setup.mockInput.pressKey("h", { ctrl: true }));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressEnter());
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-2");
    expect(setup.renderer.root.findDescendantById("terminal:pane-2")).toBe(remembered!);
  } finally {
    act(() => setup.renderer.destroy());
    setup.store.stop();
  }
});

for (const action of ["item Enter", "root Enter"] as const) {
  for (const order of ["response first", "snapshot first"] as const) {
    test(`${action} enters its new pane with ${order}`, async () => {
      const open = deferred<CommandResponse>();
      let publishSnapshot!: Dispatch<SetStateAction<Snapshot>>;
      const sent: Command[] = [];
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
          ...surfaceSnapshot(),
          revision: 1,
          items: surfaceSnapshot().items,
          surfaces: [],
          tabs: [],
          panes: [],
          navigation: [
            { ...surfaceSnapshot().navigation[0]!, itemId: "root-1", tabId: null, paneId: null },
          ],
        }));
        publishSnapshot = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({
              snapshot,
              command: (command) => {
                sent.push(command);
                return open.promise;
              },
            })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        if (action === "item Enter") {
          await act(async () => setup.mockInput.pressKey("l"));
          await act(async () => setup.mockInput.pressKey("j"));
          await act(async () => setup.mockInput.pressEnter());
        } else {
          await act(async () => setup.mockInput.pressEnter());
        }
        expect(sent).toEqual([
          action === "item Enter"
            ? { type: "session.openItem", sessionId: "session-work", itemId: "item-1" }
            : { type: "session.openItem", sessionId: "session-work", itemId: "root-1" },
        ]);
        const ready = {
          ...surfaceSnapshot(),
          revision: 3,
          navigation: [
            {
              ...surfaceSnapshot().navigation[0]!,
              generation: 2,
              itemId: action === "root Enter" ? "root-1" : "item-1",
            },
          ],
          surfaces: [
            {
              ...surfaceSnapshot().surfaces[0]!,
              itemId: action === "root Enter" ? "root-1" : "item-1",
            },
          ],
        };
        if (order === "snapshot first") {
          act(() => publishSnapshot(ready));
          await setup.flush();
        }
        await act(async () =>
          open.resolve({
            ok: true,
            revision: 3,
            result: {
              id: "surface-1",
              itemId: "item-1",
              surfaceId: "surface-1",
              tabId: "tab-1",
              paneId: "pane-1",
              navigation: ready.navigation[0],
            },
          }),
        );
        if (order === "response first") {
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
          act(() =>
            publishSnapshot({
              ...ready,
              revision: 2,
              items: ready.items,
              surfaces: [],
              tabs: [],
              panes: [],
              navigation: [
                {
                  ...ready.navigation[0]!,
                  generation: 1,
                  itemId: "root-1",
                  tabId: null,
                  paneId: null,
                },
              ],
            }),
          );
          await setup.flush();
          expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
          act(() => publishSnapshot(ready));
        }
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("project expansion and collapse cancel a pending open-focus handoff", async () => {
  const open = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: {
          ...surfaceSnapshot(),
          navigation: [{ ...surfaceSnapshot().navigation[0]!, itemId: "root-1" }],
          surfaces: surfaceSnapshot().surfaces.map((surface) => ({ ...surface, itemId: "root-1" })),
        },
        command: () => open.promise,
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    await act(async () => setup.mockInput.pressEnter());
    await act(async () => setup.mockInput.pressKeys(["l", "h"]));
    await act(async () =>
      open.resolve({
        ok: true,
        revision: 4,
        result: { id: "surface-1", itemId: "item-1", surfaceId: "surface-1" },
      }),
    );
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const when of ["before response", "after response"] as const) {
  for (const interaction of ["native leave-and-return", "local browsing at an edge"] as const) {
    test(`item-open focus is cancelled by ${interaction} ${when}`, async () => {
      const open = deferred<CommandResponse>();
      let publishSnapshot!: Dispatch<SetStateAction<Snapshot>>;
      function Fixture() {
        const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
          ...surfaceSnapshot(),
          revision: 1,
          surfaces: [],
          tabs: [],
          panes: [],
        }));
        publishSnapshot = setSnapshot;
        return (
          <WorkCraftShell
            workCraft={workCraftStateFixture({ snapshot, command: () => open.promise })}
          />
        );
      }
      const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
      try {
        await setup.flush();
        act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
        await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
        await act(async () => setup.mockInput.pressKey("l"));
        await act(async () => setup.mockInput.pressKey("j"));
        await act(async () => setup.mockInput.pressEnter());
        const response: CommandResponse = {
          ok: true,
          revision: 3,
          result: { id: "surface-1", itemId: "item-1", surfaceId: "surface-1", paneId: "pane-1" },
        };
        if (when === "after response") {
          await act(async () => open.resolve(response));
        }
        if (interaction === "native leave-and-return") {
          // No React commit between focus changes: returning does not revive the request.
          act(() => {
            setup.renderer.root.findDescendantById("region:category")!.focus();
            setup.renderer.root.findDescendantById("region:navigator")!.focus();
          });
        } else {
          await act(async () => setup.mockInput.pressKey("h"));
        }
        if (when === "before response") {
          await act(async () => open.resolve(response));
        }
        act(() => publishSnapshot({ ...surfaceSnapshot(), revision: 3 }));
        await setup.flush();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("starting entry waits, failure reports status and a later running snapshot never revives it", async () => {
  const initial = surfaceSnapshot();
  initial.panes[0]!.processStatus = "starting";
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(initial);
    publish = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    act(() =>
      publish({
        ...initial,
        revision: 6,
        panes: [{ ...initial.panes[0]!, processStatus: "failed", errorText: "spawn refused" }],
      }),
    );
    await setup.flush();
    expect(statusText(setup)).toContain("failed");
    act(() =>
      publish({
        ...initial,
        revision: 7,
        panes: [{ ...initial.panes[0]!, processStatus: "running" }],
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("buffered browsing then Archive confirms and archives the live candidate rather than the previous row", async () => {
  const snapshot = workCraftStateFixture().snapshot!;
  for (const item of snapshot.items) {
    if (item.kind !== "generic") {
      item.data.availability = "unavailable";
    }
  }
  const commands: Command[] = [];
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot,
        command: async (command) => {
          commands.push(command);
          return { ok: true, revision: snapshot.revision, result: { id: "item-1" } };
        },
      })}
    />,
    { width: 120, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    act(() => setup.renderer.root.findDescendantById("region:navigator")!.focus());
    await act(async () => setup.mockInput.pressKey("l"));
    await setup.flush();
    await act(async () => {
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("a");
    });
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Archive Ship navigator?");
    await act(async () => setup.mockInput.pressEnter());
    expect(commands).toEqual([{ type: "item.setArchived", itemId: "item-1", archived: true }]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("a deliberate successful terminal retry clears its matching entry failure without reviving old intent", async () => {
  const initial = surfaceSnapshot();
  initial.panes[0]!.processStatus = "exited";
  let publish!: Dispatch<SetStateAction<Snapshot>>;
  function Fixture() {
    const [snapshot, setSnapshot] = useState(initial);
    publish = setSnapshot;
    return <WorkCraftShell workCraft={workCraftStateFixture({ snapshot })} />;
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 30, kittyKeyboard: true });
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(statusText(setup)).toContain("Terminal entry failed");
    act(() =>
      publish({
        ...initial,
        revision: initial.revision + 1,
        panes: [{ ...initial.panes[0]!, processStatus: "running" }],
      }),
    );
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    expect(statusText(setup)).not.toContain("Terminal entry failed");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("drawer entry closes coverage without remounting its terminal and dismissal restores focus", async () => {
  const setup = await testRender(
    <WorkCraftShell workCraft={workCraftStateFixture({ snapshot: surfaceSnapshot() })} />,
    { width: 120, height: 30, kittyKeyboard: true },
  );
  try {
    await setup.flush();
    await openFixtureItem(setup);
    await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
    const terminal = setup.renderer.root.findDescendantById("terminal:pane-1");
    act(() => setup.resize(100, 30));
    await setup.flush();
    await act(async () => setup.mockInput.pressKeys(["\x00b"]));
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("navigator-controls")?.width).toBe(95);
    expect(terminal?.focusable).toBe(false);
    await act(async () => setup.mockInput.pressEnter());
    await setup.flush();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
    expect(setup.renderer.root.findDescendantById("terminal:pane-1") === terminal).toBe(true);
    await act(async () => setup.mockInput.pressKeys(["\x00b"]));
    await setup.flush();
    await act(async () => setup.mockInput.pressEscape());
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("terminal:pane-1");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("browsing stays local until Enter activates the item", async () => {
  const commands: Command[] = [];
  function Fixture() {
    const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
      ...surfaceSnapshot(),
      navigation: [
        { ...surfaceSnapshot().navigation[0]!, itemId: "root-1", tabId: null, paneId: null },
      ],
    }));
    return (
      <WorkCraftShell
        workCraft={workCraftStateFixture({
          snapshot,
          command: async (command) => {
            commands.push(command);
            const selected = surfaceSnapshot();
            selected.revision = 5;
            selected.navigation[0]!.generation = 2;
            setSnapshot(selected);
            return {
              ok: true,
              revision: 5,
              result: { id: "item-1", navigation: selected.navigation[0] },
            };
          },
        })}
      />
    );
  }
  const setup = await testRender(<Fixture />, { width: 120, height: 40, kittyKeyboard: true });
  await setup.flush();
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l"));
  await act(async () => setup.mockInput.pressKey("j"));
  expect(commands).toEqual([]);
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeUndefined();

  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();
  expect(commands[0]).toEqual({
    type: "session.openItem",
    sessionId: "session-work",
    itemId: "item-1",
  });
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("a current item-open failure remains visible after activation", async () => {
  const open = deferred<CommandResponse>();
  const setup = await testRender(
    <WorkCraftShell
      workCraft={workCraftStateFixture({
        snapshot: surfaceSnapshot(),
        command: async (command) =>
          command.type === "session.openItem"
            ? open.promise
            : { ok: true, revision: 1, result: { id: "result-1" } },
      })}
    />,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  await setup.flush();
  act(() => setup.renderer.root.findDescendantById("region:category")!.focus());
  await act(async () => setup.mockInput.pressKey("l", { ctrl: true }));
  await act(async () => setup.mockInput.pressKey("l"));
  await act(async () => setup.mockInput.pressKey("j"));
  await act(async () => setup.mockInput.pressEnter());
  await setup.flush();

  await act(async () => {
    open.reject(new Error("open failed"));
    await open.promise.catch(() => {});
  });
  await setup.flush();

  expect(setup.captureCharFrame()).toContain("open failed");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
  expect(setup.renderer.root.findDescendantById("terminal:pane-1")).toBeDefined();
  act(() => setup.renderer.destroy());
});
