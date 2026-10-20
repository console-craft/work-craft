import { expect, test } from "bun:test";

import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/tests/support/render";
import { CardFooter } from "@/ui/components/card";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("footer visibility and width include its divider", async () => {
  let setVisible!: Dispatch<SetStateAction<boolean>>;
  function Fixture() {
    const [visible, updateVisible] = useState(true);
    setVisible = updateVisible;
    return (
      <ThemeProvider theme={defaultTheme}>
        <CardFooter width={20} visible={visible} justifyContent="flex-end">
          <Text>OK</Text>
        </CardFooter>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 40, height: 5 });
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("OK");
    expect(setup.captureCharFrame()).toContain("─");

    act(() => setVisible(false));
    await act(async () => setup.flush());
    expect(setup.captureCharFrame().trim()).toBe("");

    act(() => setVisible(true));
    await act(async () => setup.flush());
    const rows = setup.captureCharFrame().split("\n");
    expect(rows[0]?.trim().length).toBe(20);
    expect(rows[1]?.indexOf("OK")).toBe(17);
  } finally {
    act(() => setup.renderer.destroy());
  }
});
