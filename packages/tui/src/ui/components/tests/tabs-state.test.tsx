import { expect, test } from "bun:test";

import { act, useState } from "react";

import { testRender } from "@/tests/support/render";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Button } from "@/ui/controls/button";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";

test("stale deferred panel activation cannot survive trigger replacement at the same value", async () => {
  let replace = () => {};
  let acknowledge = () => {};
  const requests: string[] = [];
  function Fixture() {
    const [value, setValue] = useState("first");
    const [generation, setGeneration] = useState(0);
    replace = () => setGeneration((previous) => previous + 1);
    acknowledge = () => setValue("second");
    return (
      <ThemeProvider theme={defaultTheme}>
        <Tabs value={value} onValueChange={(next) => requests.push(next)}>
          <TabsList id="strip">
            <TabsTrigger value="first">First</TabsTrigger>
            <TabsTrigger key={generation} value="second">
              Second
            </TabsTrigger>
          </TabsList>
          <TabsContent value="first">
            <Button>First action</Button>
          </TabsContent>
          <TabsContent key={generation} value="second">
            <Button id={`action-${generation}`}>Second action</Button>
          </TabsContent>
        </Tabs>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 40, height: 12 });
  try {
    await act(async () => setup.flush());
    const strip = setup.renderer.root.findDescendantById("strip")!;
    const oldAction = setup.renderer.root.findDescendantById("action-0")!;
    act(() => strip.focus());
    act(() => {
      setup.mockInput.pressArrow("right");
      setup.mockInput.pressEnter();
    });
    expect(requests).toEqual(["second"]);
    expect(setup.renderer.currentFocusedRenderable).toBe(strip);
    act(() => replace());
    await act(async () => setup.flush());
    act(() => acknowledge());
    await act(async () => setup.flush());
    expect(oldAction.isDestroyed).toBe(true);
    expect(oldAction.focused).toBe(false);
    expect(setup.renderer.currentFocusedRenderable).toBe(strip);
    expect(setup.renderer.root.findDescendantById("action-1")!.focused).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});
