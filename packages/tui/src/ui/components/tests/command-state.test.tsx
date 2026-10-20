import { expect, spyOn, test } from "bun:test";

import { act, useState } from "react";

import { testRender } from "@/tests/support/render";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  type CommandProps,
} from "@/ui/components/command";
import { Box } from "@/ui/primitives/box";
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

test("removed command registrations cannot activate after callback-driven teardown", async () => {
  let removeNative = () => {};
  let selected = 0;
  const errors = spyOn(console, "error");
  function Fixture() {
    const [shown, setShown] = useState(true);
    return (
      <ThemeProvider theme={defaultTheme}>
        {shown ? (
          <Box id="owner">
            <Command>
              <CommandInput id="query" />
              <CommandList height={4}>
                <CommandItem
                  onSelect={() => {
                    selected++;
                    removeNative();
                    setShown(false);
                  }}
                >
                  Remove me
                </CommandItem>
              </CommandList>
            </Command>
          </Box>
        ) : (
          <Box />
        )}
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 40, height: 8 });
  removeNative = () => {
    setup.renderer.root.findDescendantById("owner")!.visible = false;
  };
  try {
    await act(async () => setup.flush());
    act(() => setup.renderer.root.findDescendantById("query")!.focus());
    act(() => {
      setup.mockInput.pressEnter();
      setup.mockInput.pressEnter();
    });
    await act(async () => setup.flush());
    expect(selected).toBe(1);
    expect(setup.renderer.root.findDescendantById("query")).toBeUndefined();
    expect(errors.mock.calls).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
    errors.mockRestore();
  }
});
