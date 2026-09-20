import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { CreatePrompt } from "./create-prompt.tsx";
import { NavigationPane } from "./navigation-pane.tsx";
import { SessionChooser } from "./session-chooser.tsx";
import { SessionSwitcher, StatusBar, WorkspaceStrip } from "./shell-regions.tsx";
import type { NavigatorEntry } from "./navigation.ts";

const entries: NavigatorEntry[] = [
  {
    key: "project:project-1",
    kind: "project",
    id: "project-1",
    projectId: "project-1",
    label: "Work Craft",
    depth: 0,
  },
  {
    key: "item:item-1",
    kind: "item",
    id: "item-1",
    projectId: "project-1",
    label: "Ship navigator",
    depth: 1,
  },
];

test("navigator renders one stable projection in expanded and compact modes", async () => {
  const expanded = await testRender(
    <NavigationPane
      activeKey="project:project-1"
      cursorKey="item:item-1"
      entries={entries}
      error={null}
      focused
      mode="expanded"
      width={24}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 30, height: 10 },
  );
  await expanded.flush();
  expect(expanded.captureCharFrame()).toContain("Work Craft");
  expect(expanded.captureCharFrame()).toContain("Ship navigator");
  act(() => expanded.renderer.destroy());

  const compact = await testRender(
    <NavigationPane
      activeKey="project:project-1"
      cursorKey="item:item-1"
      entries={entries}
      error={null}
      focused
      mode="compact"
      width={7}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 10, height: 10 },
  );
  await compact.flush();
  const frame = compact.captureCharFrame();
  expect(frame).toContain("WC");
  expect(frame).toContain("·");
  expect(frame).not.toContain("Ship navigator");
  act(() => compact.renderer.destroy());
});

test("compact navigator status exposes the full cursor label", async () => {
  const setup = await testRender(<StatusBar mode="INFO" text="Ship navigator" />, {
    width: 40,
    height: 2,
  });
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("INFO  Ship navigator");
  act(() => setup.renderer.destroy());
});

test("workspace overflow leaves the session control and connection dot pinned", async () => {
  const setup = await testRender(
    <box flexDirection="row" width="100%">
      <WorkspaceStrip
        activeId="b"
        cursorId="c"
        focused={false}
        hasNext
        hasPrevious
        visibleIds={["b", "c"]}
        workspaces={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
          { id: "c", name: "Gamma" },
          { id: "d", name: "Delta" },
        ]}
        onActivate={() => {}}
        onFocus={() => {}}
      />
      <SessionSwitcher focused={false} name="Work" status="connecting" onOpen={() => {}} />
    </box>,
    { width: 50, height: 3 },
  );
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("<");
  expect(frame).toContain(">");
  expect(frame).toContain("Work");
  expect(setup.renderer.root.findDescendantById("connection-status")).toBeDefined();
  act(() => setup.renderer.destroy());
});

test("controlled dialog bodies render without owning global keyboard state", async () => {
  const chooser = await testRender(
    <SessionChooser
      cursorId="session-1"
      sessions={[{ id: "session-1", name: "Main", position: 0 }]}
      onCreate={() => {}}
      onFocus={() => {}}
      onSelect={() => {}}
    />,
    { width: 40, height: 8 },
  );
  await chooser.flush();
  expect(chooser.captureCharFrame()).toContain("Sessions");
  act(() => chooser.renderer.destroy());

  const prompt = await testRender(
    <CreatePrompt
      error="Name already exists"
      kind="workspace"
      value="Alpha"
      onChange={() => {}}
      onSubmit={() => {}}
    />,
    { width: 40, height: 8 },
  );
  await prompt.flush();
  expect(prompt.captureCharFrame()).toContain("Name already exists");
  act(() => prompt.renderer.destroy());
});

test("mouse-down focuses and activates a workspace through the same callbacks", async () => {
  const calls: string[] = [];
  const setup = await testRender(
    <WorkspaceStrip
      activeId="a"
      cursorId="a"
      focused
      hasNext={false}
      hasPrevious={false}
      visibleIds={["a"]}
      workspaces={[{ id: "a", name: "Alpha" }]}
      onActivate={(id) => calls.push(`activate:${id}`)}
      onFocus={(id) => calls.push(`focus:${id}`)}
    />,
    { width: 30, height: 3 },
  );
  await setup.flush();
  const row = setup.renderer.root.findDescendantById("workspace:a");
  expect(row).toBeDefined();
  await act(async () => {
    await setup.mockMouse.click(row!.screenX, row!.screenY);
  });
  expect(calls).toEqual(["focus:a", "activate:a"]);
  act(() => setup.renderer.destroy());
});
