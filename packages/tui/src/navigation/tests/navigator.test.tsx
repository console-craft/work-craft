import { expect, test } from "bun:test";

import {
  BoxRenderable,
  CliRenderEvents,
  parseColor,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { act, useState } from "react";

import { navigatorEntries } from "@/navigation/model.ts";
import { Navigator } from "@/navigation/navigator.tsx";
import { snapshotFixture } from "@/tests/support/fixtures.ts";
import { testRender } from "@/tests/support/render";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

async function fixture() {
  const opened: string[] = [];
  const candidates: (string | null)[] = [];
  function Fixture() {
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(["root-1"]));
    return (
      <ThemeProvider theme={defaultTheme}>
        <Navigator
          entries={navigatorEntries(
            snapshotFixture(),
            "workspace-shared",
            "implementation",
            expanded,
            query,
            "/work",
          )}
          query={query}
          homePath="/work"
          activeItemId="root-1"
          initialCursorId="root-1"
          title="Coding"
          width={40}
          height={14}
          interactive
          focusedControl="filter"
          onQueryChange={setQuery}
          onCursorChange={(id) => candidates.push(id)}
          onInteraction={() => {}}
          onExpand={(id, value) => setExpanded(value ? new Set([id]) : new Set())}
          onActivate={(id) => opened.push(id)}
        />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 50, height: 18 });
  await act(async () => setup.flush());
  return { ...setup, opened, candidates };
}

test("filter edits n o a j k h l Space and Enter does not open; Tab cycles two native stops", async () => {
  const f = await fixture();
  try {
    await act(async () => f.mockInput.typeText("noajkhl "));
    expect(f.opened).toEqual([]);
    await act(async () => f.mockInput.pressEnter());
    expect(f.opened).toEqual([]);
    expect(f.renderer.currentFocusedRenderable?.id).toBe("navigator:filter");
    await act(async () => f.mockInput.pressKey("u", { ctrl: true }));
    await act(async () => f.mockInput.pressTab());
    expect(f.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => f.mockInput.pressTab({ shift: true }));
    expect(f.renderer.currentFocusedRenderable?.id).toBe("navigator:filter");
  } finally {
    act(() => f.renderer.destroy());
  }
});

test("buffered query transfer never opens an old row and first match is not contextual ancestor", async () => {
  const f = await fixture();
  try {
    act(() => {
      f.mockInput.typeText("feature");
      f.mockInput.pressKey("n", { ctrl: true });
      f.mockInput.pressEnter();
    });
    expect(f.opened).toEqual([]);
    await act(async () => f.flush());
    expect(f.renderer.currentFocusedRenderable?.id).toBe("region:navigator");
    await act(async () => f.mockInput.pressEnter());
    expect(f.opened).toEqual(["item-1"]);
  } finally {
    act(() => f.renderer.destroy());
  }
});

test("narrow Navigator results show only a horizontal scrollbar when their rows fit", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Navigator
        entries={navigatorEntries(
          snapshotFixture(),
          "workspace-shared",
          "implementation",
          new Set(["root-1"]),
          "",
          "/work",
        )}
        query=""
        homePath="/work"
        activeItemId="root-1"
        initialCursorId="root-1"
        title="Coding"
        width={20}
        height={24}
        interactive
        focusedControl="results"
        onQueryChange={() => {}}
        onCursorChange={() => {}}
        onExpand={() => {}}
        onActivate={() => {}}
        onInteraction={() => {}}
      />
    </ThemeProvider>,
    { width: 40, height: 26 },
  );
  try {
    await act(async () => setup.flush());
    const list = setup.renderer.root.findDescendantById("region:navigator")!;
    const area = list.getChildren()[0] as ScrollBoxRenderable;
    expect(area.content.getChildren()).toHaveLength(2);
    expect(area.horizontalScrollBar.visible).toBe(true);
    expect(area.verticalScrollBar.visible).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("two-cell rows use stable IDs, themed filter border, path and branch, and primary-release activation", async () => {
  const f = await fixture();
  try {
    const row = f.renderer.root.findDescendantById("navigator-row:item-1")!;
    expect(row.height).toBe(2);
    expect(row.focusable).toBe(false);
    expect(f.captureCharFrame()).toContain("feature");
    expect(f.captureCharFrame()).toContain("~/Ship navigator");
    const list = f.renderer.root.findDescendantById("region:navigator") as BoxRenderable;
    const filterBorder = f.renderer.root.findDescendantById("navigator:filter")!
      .parent as BoxRenderable;
    expect(filterBorder.borderColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.border).toInts(),
    );
    await act(async () => f.mockMouse.click(row.screenX + 10, row.screenY));
    expect(f.opened).toEqual(["item-1"]);
    expect(f.renderer.currentFocusedRenderable).toBe(list);
  } finally {
    act(() => f.renderer.destroy());
  }
});

test("shrinking the navigator preserves the filter and settles its results scrollbars", async () => {
  let shrink!: () => void;
  function Fixture() {
    const [height, setHeight] = useState(35);
    shrink = () => setHeight(10);
    return (
      <ThemeProvider theme={defaultTheme}>
        <Navigator
          entries={navigatorEntries(
            snapshotFixture(),
            "workspace-shared",
            "implementation",
            new Set(["root-1"]),
          )}
          query=""
          homePath="/work"
          activeItemId="item-1"
          initialCursorId="item-1"
          title="Coding"
          width={45}
          height={height}
          interactive
          focusedControl={null}
          onQueryChange={() => {}}
          onCursorChange={() => {}}
          onExpand={() => {}}
          onActivate={() => {}}
          onInteraction={() => {}}
        />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 50, height: 40 });
  const errors: Error[] = [];
  setup.renderer.on(CliRenderEvents.RENDER_ERROR, ({ error }) => errors.push(error));
  try {
    await act(async () => setup.flush());
    await act(async () => shrink());
    await act(async () => setup.flush());
    const root = setup.renderer.root;
    const filter = root.findDescendantById("navigator:filter")!;
    const list = root.findDescendantById("region:navigator")!;
    const area = list.getChildren()[0] as ScrollBoxRenderable;
    expect(errors).toEqual([]);
    expect(filter.parent!.height).toBe(3);
    expect(area.viewport.height).toBe(3);
    expect(area.verticalScrollBar.visible).toBe(true);
    expect(area.horizontalScrollBar.visible).toBe(false);
    act(() => area.scrollTo({ x: 0, y: 1 }));
    await act(async () => setup.flush());
    expect(area.scrollTop).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    await setup.renderer.closed;
  }
});
