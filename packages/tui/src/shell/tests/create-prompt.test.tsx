import { expect, test } from "bun:test";

import type { InputRenderable } from "@opentui/core";
import { act } from "react";

import { CreatePrompt } from "@/shell/create-prompt";
import type { CreateKind } from "@/shell/model";
import { testRender } from "@/tests/support/render";
import { Dialog, DialogContent } from "@/ui/components/dialog";
import { FocusManager } from "@/ui/focus-manager";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

async function renderPrompt(kind: CreateKind, submitted: string[], error: string | null = null) {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="page" />
      <Box id="page">
        <Dialog open>
          <DialogContent
            initialFocusId={
              kind === "directory"
                ? "create:path"
                : kind.startsWith("generic-")
                  ? "create:title"
                  : "create:name"
            }
          >
            <CreatePrompt
              kind={kind}
              value=""
              error={error}
              onChange={() => {}}
              onSubmit={(name) => submitted.push(name)}
            />
          </DialogContent>
        </Dialog>
      </Box>
    </ThemeProvider>,
    { width: 80, height: 25, kittyKeyboard: true, exitOnCtrlC: false },
  );
  await act(async () => setup.flush());
  return setup;
}

for (const kind of [
  "session",
  "workspace",
  "directory",
  "generic-root",
  "generic-child",
] as const) {
  for (const action of ["enter", "button"] as const) {
    test(`${kind} creation ${action} submits the trimmed live name`, async () => {
      const submitted: string[] = [];
      const setup = await renderPrompt(kind, submitted);
      try {
        expect(setup.captureCharFrame()).toContain(
          kind === "directory"
            ? "Register directory"
            : `New ${kind.startsWith("generic-") ? "item" : kind}`,
        );
        // No render between typing, Tab and activation: the rendered value is still empty.
        await act(async () =>
          setup.mockInput.pressKeys([action === "enter" ? "  draft  \r" : "  draft  \t\r"]),
        );
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          action === "enter"
            ? kind === "directory"
              ? "create:path"
              : kind.startsWith("generic-")
                ? "create:title"
                : "create:name"
            : "create:submit",
        );
        expect(submitted).toEqual([kind === "directory" ? "  draft  " : "draft"]);
        expect(setup.captureCharFrame()).toContain(
          kind === "directory" ? "Path" : kind.startsWith("generic-") ? "Title" : "Name",
        );
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

for (const action of ["enter", "button"] as const) {
  for (const value of ["", "   "]) {
    test(`creation ${action} shows feedback for ${value === "" ? "empty" : "whitespace-only"} names`, async () => {
      const submitted: string[] = [];
      const setup = await renderPrompt("session", submitted);
      try {
        await act(async () => setup.mockInput.typeText(value));
        if (action === "enter") {
          await act(async () => setup.mockInput.pressEnter());
        } else {
          const create = setup.renderer.root.findDescendantById("create:submit")!;
          await act(async () => setup.mockMouse.click(create.screenX, create.screenY));
        }
        await act(async () => setup.flush());
        expect(submitted).toEqual([]);
        expect(setup.captureCharFrame()).toContain("Name is required.");
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(
          action === "enter" ? "create:name" : "create:submit",
        );
        const input = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
        expect(input.value).toBe(value);
        act(() => input.focus());
        await act(async () => setup.mockInput.typeText("draft"));
        await act(async () => setup.flush());
        expect(setup.captureCharFrame()).not.toContain("Name is required.");
        await act(async () => setup.mockInput.pressEnter());
        expect(submitted).toEqual(["draft"]);
      } finally {
        act(() => setup.renderer.destroy());
      }
    });
  }
}

test("creation displays its field error and Ctrl+C clears without submitting or closing", async () => {
  const submitted: string[] = [];
  const setup = await renderPrompt("session", submitted, "Name already exists");
  try {
    expect(setup.captureCharFrame()).toContain("Name already exists");
    const input = setup.renderer.root.findDescendantById("create:name") as InputRenderable;
    await act(async () => setup.mockInput.typeText("draft"));
    await act(async () => setup.mockInput.pressCtrlC());
    expect(input.value).toBe("");
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    expect(submitted).toEqual([]);
    expect(setup.captureCharFrame()).toContain("New session");
  } finally {
    act(() => setup.renderer.destroy());
  }
});
