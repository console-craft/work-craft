import { expect, test } from "bun:test";

import { type BoxRenderable, TextRenderable } from "@opentui/core";
import { act, useState } from "react";

import { testRender } from "@/tests/support/render";
import { Badge } from "@/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/table";
import { Button } from "@/ui/controls/button";
import { FocusManager } from "@/ui/focus-manager";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("table sizes rows from wrapped content and reflows on resize without a fixed height", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack width="100%">
        <Table id="table" columns={[40, null, 20]} border="full">
          <TableHeader id="header">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow id="wrapped-row">
              <TableCell>Server</TableCell>
              <TableCell>A long status that should wrap naturally across several lines</TableCell>
              <TableCell>31ms</TableCell>
            </TableRow>
            <TableRow id="short-row">
              <TableCell>DB</TableCell>
              <TableCell>Healthy</TableCell>
              <TableCell>42ms</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Text id="after">After the table</Text>
      </Stack>
    </ThemeProvider>,
    { width: 40, height: 24 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const table = setup.renderer.root.findDescendantById("table")!;
    const header = setup.renderer.root.findDescendantById("header")!;
    const wrapped = setup.renderer.root.findDescendantById("wrapped-row")!;
    const short = setup.renderer.root.findDescendantById("short-row")!;
    expect(header.height).toBe(2);
    expect(short.height).toBe(2);
    expect(wrapped.height).toBeGreaterThan(1);
    expect(table.height).toBe(header.height + wrapped.height + short.height + 2);
    expect(setup.captureCharFrame()).toContain("After the table");
    expect(setup.captureCharFrame()).toContain("several");
    expect(setup.captureCharFrame()).toContain("lines");
    const narrowHeight = table.height;
    act(() => setup.resize(80, 24));
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(table.height).toBeLessThan(narrowHeight);
    const after = setup.renderer.root.findDescendantById("after")!;
    expect(after.screenY).toBe(table.screenY + table.height + 1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("cells stretch to the tallest composed content and retain control focus inside a scroll area", async () => {
  let presses = 0;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="scope" />
      <ScrollArea id="scope" height={4} width={40}>
        <Table border="none" striped>
          <TableBody>
            <TableRow id="composed-row">
              <TableCell id="short-cell" bg="secondary">
                <Badge color="success">Ready</Badge>
              </TableCell>
              <TableCell>
                <Stack gap={0}>
                  <Text>Build finished</Text>
                  <Text>All checks passed</Text>
                  <Text>Release available</Text>
                </Stack>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Next step</TableCell>
              <TableCell paddingX={0}>
                <Button id="action" onPress={() => presses++}>
                  Deploy
                </Button>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Last row</TableCell>
              <TableCell>Done</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ScrollArea>
    </ThemeProvider>,
    { width: 40, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const row = setup.renderer.root.findDescendantById("composed-row")!;
    const cell = setup.renderer.root.findDescendantById("short-cell")!;
    expect(row.height).toBe(3);
    expect(cell.height).toBe(row.height);
    const button = setup.renderer.root.findDescendantById("action")!;
    expect(setup.renderer.currentFocusedRenderable).toBe(button);
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    expect(presses).toBe(1);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("no-wrap tables truncate textual children without expanding rows", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack>
        <Table wrap={false} border="none" columns={[50, 50]}>
          <TableHeader>
            <TableRow>
              <TableHead>Long header that should truncate</TableHead>
              <TableHead>Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow id="row">
              <TableCell>Long message that should truncate</TableCell>
              <TableCell textAlign="right">Count {2}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Stack>
    </ThemeProvider>,
    { width: 30, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("row")!.height).toBe(1);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Count 2 ");
    expect(frame).not.toContain("should truncate");
    expect(frame).toContain("...");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each(["none", "minimal", "full"] as const)(
  "table %s borders stay intentional when colors and styles are customized",
  async (border) => {
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        <Stack>
          <Table
            id="table"
            columns={[50, 50]}
            border={border}
            borderColor="primary"
            borderStyle="double"
          >
            <TableHeader>
              <TableRow id="head-row">
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow id="first-row">
                <TableCell>Server</TableCell>
                <TableCell>Healthy</TableCell>
              </TableRow>
              <TableRow id="second-row">
                <TableCell>Worker</TableCell>
                <TableCell>Ready</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Stack>
      </ThemeProvider>,
      { width: 40, height: 12 },
    );
    try {
      await act(async () => setup.flush());
      await act(async () => setup.flush());
      const table = setup.renderer.root.findDescendantById("table")!;
      expect(table.height).toBe(border === "none" ? 3 : border === "minimal" ? 5 : 7);
      const row = setup.renderer.root.findDescendantById("first-row")!;
      expect(row.width).toBe(border === "full" ? 38 : 40);
      const cells = row.getChildren() as BoxRenderable[];
      expect(cells[0]!.border).toEqual([]);
      expect(cells[1]!.border).toEqual(border === "full" ? ["left"] : []);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Healthy");
      expect(frame).not.toContain("╭");
      expect(frame.includes("═")).toBe(border !== "none");
      if (border === "full") {
        for (const junction of ["╦", "╩", "╬", "╠", "╣"]) {
          expect(frame).toContain(junction);
        }
      }
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);

test("text respects cell padding at fractional column widths", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Table columns={[40, null, 20]} border="full">
        <TableBody>
          <TableRow id="row">
            <TableCell>Server</TableCell>
            <TableCell>Long text wraps within the padded cell</TableCell>
            <TableCell textAlign="right">31ms</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ThemeProvider>,
    { width: 40, height: 12 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const row = setup.renderer.root.findDescendantById("row")!;
    for (const column of row.getChildren()) {
      const cell = column.getChildren()[0]!;
      const text = cell.getChildren()[0] as TextRenderable;
      expect(text.screenX).toBe(cell.screenX + 1);
      expect(text.screenX + text.width).toBeLessThanOrEqual(cell.screenX + cell.width - 1);
    }
    const text = row.getChildren()[1]!.getChildren()[0]!.getChildren()[0]!;
    expect(row.height).toBe(text.height);
    expect(setup.captureCharFrame()).toContain("31ms │");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test.each([
  [
    [10, null, null, 20],
    [4, 14, 15, 8],
  ],
  [
    [25, 25, 25, 25],
    [10, 11, 10, 10],
  ],
  [undefined, [10, 11, 10, 10]],
] as const)("column shares %j fill an odd-width row exactly", async (columns, expected) => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack>
        <Table columns={columns} border="full">
          <TableBody>
            <TableRow id="row">
              {["A", "B", "C", "D"].map((value) => (
                <TableCell key={value}>{value}</TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </Stack>
    </ThemeProvider>,
    { width: 43, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const row = setup.renderer.root.findDescendantById("row")!;
    expect(row.getChildren().map((cell) => cell.width)).toEqual([...expected]);
    const last = row.getChildren().at(-1)!;
    expect(last.screenX + last.width).toBe(row.screenX + row.width);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("full table junctions preserve native top and bottom titles", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack>
        <Table
          width={30}
          columns={[50, 50]}
          border="full"
          title="Build results summary"
          bottomTitle="Deployment summary"
        >
          <TableBody>
            <TableRow>
              <TableCell>A</TableCell>
              <TableCell>B</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Stack>
    </ThemeProvider>,
    { width: 40, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(setup.captureCharFrame()).toContain("Build results summary");
    expect(setup.captureCharFrame()).toContain("Deployment summary");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("collapsed columns cannot draw separators outside a narrow table", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack>
        <Table id="table" width={3} columns={[10, null, null, 20]} border="full">
          <TableBody>
            <TableRow>
              {["A", "B", "C", "D"].map((value) => (
                <TableCell key={value}>{value}</TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </Stack>
    </ThemeProvider>,
    { width: 20, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const table = setup.renderer.root.findDescendantById("table")!;
    const lines = setup
      .captureCharFrame()
      .split("\n")
      .slice(0, table.height)
      .map((line) => line.trimEnd());
    expect(lines[0]).toBe("╭─╮");
    expect(lines.at(-1)).toBe("╰─╯");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(3);
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("percentage row padding uses the padded parent's content width", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Stack paddingX={9} border>
        <Table border="none" columns={[50, 50]} wrap={false}>
          <TableBody>
            <TableRow id="percent-row" paddingX="10%">
              <TableCell>A</TableCell>
              <TableCell>B</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Stack>
    </ThemeProvider>,
    { width: 100, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const row = setup.renderer.root.findDescendantById("percent-row")!;
    expect(row.width).toBe(80);
    expect(row.getChildren().map((cell) => cell.width)).toEqual([32, 32]);
    expect(row.getChildren()[0]!.screenX - row.screenX).toBe(8);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

for (const { padding, widths, inset } of [
  { padding: "10%", widths: [20, 20], inset: 10 },
  { padding: "25%", widths: [6, 5], inset: 25 },
] as const) {
  test(`absolute rows resolve ${padding} padding against the parent's padding box`, async () => {
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        <Table border="none" columns={[50, 50]}>
          <TableBody paddingX={9} border height={5}>
            <TableRow id="absolute-row" position="absolute" width={60} paddingX={padding}>
              <TableCell>A</TableCell>
              <TableCell>B</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ThemeProvider>,
      { width: 100, height: 8 },
    );
    try {
      await act(async () => setup.flush());
      await act(async () => setup.flush());
      const row = setup.renderer.root.findDescendantById("absolute-row")!;
      expect(row.width).toBe(60);
      expect(row.getChildren().map((cell) => cell.width)).toEqual([...widths]);
      expect(row.getChildren()[0]!.screenX - row.screenX).toBe(inset);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}

test("row padding changes reallocate columns without an outer resize", async () => {
  function Content() {
    const [padding, setPadding] = useState(0);
    return (
      <Stack>
        <Button id="pad" onPress={() => setPadding(3)}>
          Pad row
        </Button>
        <Table columns={[50, 50]} border="none" wrap={false}>
          <TableBody>
            <TableRow id="row" paddingX={padding}>
              <TableCell>A</TableCell>
              <TableCell>B</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Stack>
    );
  }
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Content />
    </ThemeProvider>,
    { width: 40, height: 8 },
  );
  try {
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    const row = setup.renderer.root.findDescendantById("row")!;
    expect(row.getChildren().map((cell) => cell.width)).toEqual([20, 20]);
    act(() => setup.renderer.root.findDescendantById("pad")!.focus());
    act(() => setup.mockInput.pressEnter());
    await act(async () => setup.flush());
    await act(async () => setup.flush());
    expect(row.width).toBe(40);
    expect(row.height).toBe(1);
    expect(row.getChildren().map((cell) => cell.width)).toEqual([17, 17]);
    expect(row.getChildren().at(-1)!.screenX + row.getChildren().at(-1)!.width).toBe(
      row.screenX + row.width - 3,
    );
  } finally {
    act(() => setup.renderer.destroy());
  }
});
