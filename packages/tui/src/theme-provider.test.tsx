import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ThemeProvider } from "@/providers/theme-provider";
import { useTheme } from "@/hooks/use-theme";
import { gruvboxTheme } from "@/lib/terminal-themes/gruvbox";

function ThemeName() {
  return <text>{useTheme().name}</text>;
}

test("ThemeProvider supplies the Gruvbox theme", async () => {
  const setup = await testRender(
    <ThemeProvider theme={gruvboxTheme}>
      <ThemeName />
    </ThemeProvider>,
    { width: 20, height: 3 },
  );
  await setup.flush();

  try {
    expect(setup.captureCharFrame()).toContain("gruvbox");
  } finally {
    act(() => setup.renderer.destroy());
  }
});
