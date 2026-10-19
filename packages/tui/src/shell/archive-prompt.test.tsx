import { expect, test } from "bun:test";

import { act } from "react";

import { ArchivePrompt } from "@/shell/archive-prompt.tsx";
import { testRender } from "@/test-render";
import { Dialog, DialogContent } from "@/ui/components/dialog";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("Archive identifies the captured directory and confirms without closing on a failed operation", async () => {
  let confirmations = 0;
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Dialog open>
        <DialogContent initialFocusId="archive:confirm" overlayMargins={{ bottom: 1 }}>
          <ArchivePrompt
            title="Unavailable"
            path="/original/path"
            onConfirm={() => {
              confirmations += 1;
            }}
          />
        </DialogContent>
      </Dialog>
    </ThemeProvider>,
    { width: 120, height: 20 },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Archive Unavailable?");
    expect(setup.captureCharFrame()).toContain("/original/path");
    expect(setup.captureCharFrame()).toContain("Terminals keep running.");
    await act(async () => setup.mockInput.pressEnter());
    expect(confirmations).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("archive:confirm");
  } finally {
    act(() => setup.renderer.destroy());
  }
});
