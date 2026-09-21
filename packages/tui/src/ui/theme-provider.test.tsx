import { expect, test } from "bun:test";

import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import { Text } from "@/ui/primitives/text.tsx";
import { ThemeProvider, useTheme } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";

function ThemeName() {
  return <Text>{useTheme().name}</Text>;
}

test("ThemeProvider supplies its theme", async () => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <ThemeName />
    </ThemeProvider>,
    { width: 20, height: 3 },
  );
  await setup.flush();

  try {
    expect(setup.captureCharFrame()).toContain("default");
  } finally {
    act(() => setup.renderer.destroy());
  }
});
