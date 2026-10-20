import { expect, test } from "bun:test";

import { type BoxRenderable, parseColor, TextAttributes, type TextRenderable } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import {
  Alert,
  AlertContent,
  AlertDescription,
  type AlertStatus,
  AlertTitle,
} from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Progress, type ProgressProps } from "@/ui/components/progress";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("Badge styles transformed plain content including zero while preserving composed content", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Badge id="status" color="success" transform="uppercase">
        ready
      </Badge>
      <Badge id="zero">{0}</Badge>
      <Badge color="error" transform="uppercase">
        <Text id="rich" fg="info">
          Mixed
        </Text>
      </Badge>
    </ThemeProvider>,
    { width: 30, height: 5 },
  );
  try {
    await act(async () => setup.flush());
    const status = setup.renderer.root.findDescendantById("status") as BoxRenderable;
    const label = status.getChildren()[0] as TextRenderable;
    const zero = setup.renderer.root.findDescendantById("zero")!;
    const rich = setup.renderer.root.findDescendantById("rich") as TextRenderable;
    expect(setup.captureCharFrame()).toContain(" READY ");
    expect(status.width).toBe(7);
    expect(label.screenX - status.screenX).toBe(1);
    expect(status.backgroundColor.toInts()).toEqual(
      parseColor(defaultTheme.colors.success).toInts(),
    );
    expect(label.fg.toInts()).toEqual(parseColor(defaultTheme.colors.successForeground).toInts());
    expect((zero.getChildren()[0] as TextRenderable).plainText).toBe("0");
    expect(rich.plainText).toBe("Mixed");
    expect(rich.fg.toInts()).toEqual(parseColor(defaultTheme.colors.info).toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Alert keeps its icon, border and title in the current status while preserving caller overrides", async () => {
  let update!: Dispatch<SetStateAction<AlertStatus>>;
  function Fixture() {
    const [status, setStatus] = useState<AlertStatus>("info");
    update = setStatus;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Alert id="alert" status={status} width={30}>
          <AlertContent>
            <AlertTitle id="title">Status</AlertTitle>
            <AlertDescription>Details</AlertDescription>
          </AlertContent>
          <AlertTitle id="override" fg="#123456" attributes={0}>
            Custom
          </AlertTitle>
        </Alert>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 35, height: 6 });
  try {
    await act(async () => setup.flush());
    const alert = setup.renderer.root.findDescendantById("alert") as BoxRenderable;
    const icon = alert.getChildren()[0] as TextRenderable;
    const title = setup.renderer.root.findDescendantById("title") as TextRenderable;
    const override = setup.renderer.root.findDescendantById("override") as TextRenderable;
    for (const [status, symbol] of [
      ["info", "i"],
      ["success", "✓"],
      ["warning", "⚠"],
      ["error", "❌"],
    ] as const) {
      act(() => update(status));
      await act(async () => setup.flush());
      const color = parseColor(defaultTheme.colors[status]).toInts();
      expect(icon.plainText).toBe(symbol);
      expect(icon.fg.toInts()).toEqual(color);
      expect(alert.borderColor.toInts()).toEqual(color);
      expect(title.fg.toInts()).toEqual(color);
      expect(title.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
      expect(override.fg.toInts()).toEqual(parseColor("#123456").toInts());
      expect(override.attributes & TextAttributes.BOLD).toBe(0);
      expect(setup.captureCharFrame()).toContain("Details");
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Progress clamps its colored fill in solid and thin modes and follows resizing", async () => {
  let update!: Dispatch<SetStateAction<ProgressProps>>;
  function Fixture() {
    const [props, setProps] = useState<ProgressProps>({ value: 25, max: 50 });
    update = setProps;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Progress id="progress" color="success" trackColor="secondary" {...props} />
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 10, height: 3 });
  function paintedWidths(thin = false) {
    const spans = setup.renderer.currentRenderBuffer.getSpanLines()[0]!.spans;
    const fill = parseColor(defaultTheme.colors.success);
    const track = parseColor(defaultTheme.colors.secondary);
    const count = (color: typeof fill) =>
      spans
        .filter((span) => (thin ? span.fg : span.bg).equals(color))
        .reduce((width, span) => width + span.text.length, 0);
    return [count(fill), count(track)];
  }
  try {
    await act(async () => setup.flush());
    expect(paintedWidths()).toEqual([5, 5]);
    act(() => setup.resize(20, 3));
    await act(async () => setup.flush());
    expect(paintedWidths()).toEqual([10, 10]);
    for (const thin of [false, true]) {
      for (const [value, max, widths] of [
        [-1, 50, [0, 20]],
        [25, 50, [10, 10]],
        [100, 50, [20, 0]],
        [25, 0, [0, 20]],
      ] as const) {
        act(() => update({ value, max, thin }));
        await act(async () => setup.flush());
        expect(paintedWidths(thin)).toEqual([...widths]);
        expect(setup.captureCharFrame().split("\n")[0]!.trim()).toBe(thin ? "─".repeat(20) : "");
      }
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});
