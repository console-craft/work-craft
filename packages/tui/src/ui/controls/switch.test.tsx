import { expect, test } from "bun:test";

import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import { Switch } from "@/ui/controls/switch.tsx";
import { Box } from "@/ui/primitives/box.tsx";
import { ThemeProvider } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";

test("switch layout follows indicator position unless alignment is explicit", async () => {
  const cases = [
    { id: "end", indicatorPosition: "end", justifyContent: undefined, positions: [0, 18] },
    { id: "start", indicatorPosition: "start", justifyContent: undefined, positions: [0, 3] },
    {
      id: "start-override",
      indicatorPosition: "start",
      justifyContent: "space-between",
      positions: [0, 15],
    },
    { id: "end-override", indicatorPosition: "end", justifyContent: "center", positions: [6, 12] },
  ] as const;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Box>
        {cases.map(({ id, indicatorPosition, justifyContent }) => (
          <Switch
            key={id}
            id={id}
            width={20}
            indicatorPosition={indicatorPosition}
            justifyContent={justifyContent}
          >
            Label
          </Switch>
        ))}
      </Box>
    </ThemeProvider>,
    { width: 20, height: 4 },
  );
  await setup.flush();
  try {
    for (const { id, positions } of cases) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.getChildren().map((child) => child.screenX)).toEqual([...positions]);
    }
  } finally {
    act(() => setup.renderer.destroy());
  }
});
