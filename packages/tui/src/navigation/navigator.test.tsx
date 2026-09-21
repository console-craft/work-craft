import { expect, test } from "bun:test";
import { BoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { gruvboxTheme } from "@/lib/terminal-themes/gruvbox";
import { ThemeProvider } from "@/providers/theme-provider";
import type { NavigatorEntry } from "./model.ts";
import { Navigator } from "./navigator.tsx";

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
    <Navigator
      title="Implementation"
      activeKey="project:project-1"
      cursorKey="item:item-1"
      entries={entries}
      error={null}
      focused
      height={10}
      mode="expanded"
      width={24}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 30, height: 10 },
  );
  await expanded.flush();
  expect(expanded.captureCharFrame()).toContain("Implementation");
  expect(expanded.captureCharFrame()).toContain("Work Craft");
  expect(expanded.captureCharFrame()).toContain("Ship navigator");
  act(() => expanded.renderer.destroy());

  const compact = await testRender(
    <Navigator
      title="Implementation"
      activeKey="project:project-1"
      cursorKey="item:item-1"
      entries={entries}
      error={null}
      focused
      height={10}
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

test("navigator renders Unicode initials and truncates ANSI labels by visible width", async () => {
  const compact = await testRender(
    <Navigator
      title="Projects"
      activeKey={null}
      cursorKey={null}
      entries={[{ ...entries[0], label: "🧠 Craft" }]}
      error={null}
      focused={false}
      height={5}
      mode="compact"
      width={7}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 10, height: 6 },
  );
  await compact.flush();
  expect(compact.captureCharFrame()).toContain("🧠C");
  act(() => compact.renderer.destroy());

  const narrow = await testRender(
    <Navigator
      title="Projects"
      activeKey={null}
      cursorKey={null}
      entries={[{ ...entries[0], label: "\x1b[31mNavigator\x1b[0m" }]}
      error={null}
      focused={false}
      height={5}
      mode="expanded"
      width={10}
      onActivate={() => {}}
      onFocus={() => {}}
    />,
    { width: 12, height: 6 },
  );
  await narrow.flush();
  const frame = narrow.captureCharFrame();
  expect(frame).toContain("Nav…");
  expect(frame).not.toContain("Navigator");
  act(() => narrow.renderer.destroy());
});

test("navigator border uses the active theme", async () => {
  const theme = {
    ...gruvboxTheme,
    name: "semantic-test",
    colors: { ...gruvboxTheme.colors, border: "#0D0E0F" },
  };
  const setup = await testRender(
    <ThemeProvider theme={theme}>
      <Navigator
        title="Implementation"
        activeKey={null}
        cursorKey={null}
        entries={[]}
        error={null}
        focused={false}
        height={3}
        mode="expanded"
        width={20}
        onActivate={() => {}}
        onFocus={() => {}}
      />
    </ThemeProvider>,
    { width: 40, height: 8 },
  );
  await setup.flush();

  expect(
    (
      setup.renderer.root.findDescendantById("region:navigator") as BoxRenderable
    ).borderColor.toInts(),
  ).toEqual([13, 14, 15, 255]);
  act(() => setup.renderer.destroy());
});
