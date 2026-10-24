import { expect, test } from "bun:test";

import { act } from "react";

import { testRender } from "@/tests/support/render";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  type CommandProps,
} from "@/ui/components/command";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

for (const [name, filter, expected] of [
  ["disabled filtering", false, "Alpha"],
  [
    "custom filtering",
    (value: string, query: string) => query === "alias" && value === "Beta",
    "Beta",
  ],
] satisfies [string, CommandProps["filter"], string][]) {
  test(`Command ${name} selects only its eligible initial match`, async () => {
    const selected: string[] = [];
    const setup = await testRender(
      <ThemeProvider theme={defaultTheme}>
        <Command filter={filter} defaultQuery="alias">
          <CommandInput id="query" />
          <CommandList height={4}>
            <CommandItem value="Alpha" onSelect={() => selected.push("Alpha")}>
              Alpha
            </CommandItem>
            <CommandItem value="Beta" onSelect={() => selected.push("Beta")}>
              Beta
            </CommandItem>
          </CommandList>
        </Command>
      </ThemeProvider>,
      { width: 40, height: 8 },
    );
    try {
      await act(async () => setup.flush());
      act(() => setup.renderer.root.findDescendantById("query")!.focus());
      act(() => setup.mockInput.pressEnter());
      expect(selected).toEqual([expected]);
    } finally {
      act(() => setup.renderer.destroy());
    }
  });
}
