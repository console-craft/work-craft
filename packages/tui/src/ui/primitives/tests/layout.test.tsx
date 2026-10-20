import { expect, test } from "bun:test";

import { act } from "react";

import { testRender } from "@/tests/support/render";
import { Box } from "@/ui/primitives/box";
import { Center } from "@/ui/primitives/center";
import { Divider } from "@/ui/primitives/divider";
import { Grid } from "@/ui/primitives/grid";
import { Text } from "@/ui/primitives/text";
import { Wrap } from "@/ui/primitives/wrap";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

test("Grid preserves equal columns and separate gaps in a partial final row through resize", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Grid columns={3} rowGap={2} columnGap={1} width="100%">
        {["A", "B", "C", "D"].map((label) => (
          <Box key={label} id={label} height={1}>
            <Text>{label}</Text>
          </Box>
        ))}
      </Grid>
    </ThemeProvider>,
    { width: 14, height: 7 },
  );
  try {
    await act(async () => setup.flush());
    const cells = ["A", "B", "C", "D"].map((id) => setup.renderer.root.findDescendantById(id)!);
    expect(cells.map((cell) => [cell.screenX, cell.screenY, cell.width])).toEqual([
      [0, 0, 4],
      [5, 0, 4],
      [10, 0, 4],
      [0, 3, 4],
    ]);
    act(() => setup.resize(20, 7));
    await act(async () => setup.flush());
    expect(cells.map((cell) => [cell.screenX, cell.screenY, cell.width])).toEqual([
      [0, 0, 6],
      [7, 0, 6],
      [14, 0, 6],
      [0, 3, 6],
    ]);
    expect(setup.captureCharFrame().split("\n")[3]!.trim()).toBe("D");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Wrap reflows at its gap boundary while centered content and dividers retain their geometry", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Wrap width="100%" gap={1}>
        {["one", "two", "three"].map((id) => (
          <Box id={id} key={id} width={3} height={1}>
            <Text>{id[0]}</Text>
          </Box>
        ))}
      </Wrap>
      <Divider id="divider" />
      <Center id="center" width="100%" height={5}>
        <Text id="centered">OK</Text>
      </Center>
    </ThemeProvider>,
    { width: 12, height: 10 },
  );
  try {
    await act(async () => setup.flush());
    const one = setup.renderer.root.findDescendantById("one")!;
    const two = setup.renderer.root.findDescendantById("two")!;
    const three = setup.renderer.root.findDescendantById("three")!;
    const divider = setup.renderer.root.findDescendantById("divider")!;
    const center = setup.renderer.root.findDescendantById("center")!;
    const text = setup.renderer.root.findDescendantById("centered")!;
    expect([one.screenX, two.screenX, three.screenX]).toEqual([0, 4, 8]);
    expect(text.screenX).toBe(5);
    expect(text.screenY - center.screenY).toBe(2);
    act(() => setup.resize(10, 10));
    await act(async () => setup.flush());
    expect(three.screenX).toBe(0);
    expect(three.screenY - one.screenY).toBe(2);
    expect(divider.screenY).toBe(3);
    expect(divider.height).toBe(1);
    expect(setup.captureCharFrame().split("\n")[divider.screenY]!.trim()).toBe("──────────");
    expect(text.screenX).toBe(4);
    expect(text.screenY - center.screenY).toBe(2);
  } finally {
    act(() => setup.renderer.destroy());
  }
});
