import { expect, test } from "bun:test";

import { act } from "react";

import { CreatePrompt } from "@/shell/create-prompt.tsx";
import { SessionChooser } from "@/shell/session-chooser.tsx";
import { testRender } from "@/shell/tests/fixtures";
import { Dialog } from "@/ui/components/dialog";

test("controlled dialog bodies render without owning global keyboard state", async () => {
  const chooser = await testRender(
    <Dialog open>
      <SessionChooser
        canCancel={false}
        sessions={[{ id: "session-1", name: "Main", position: 0 }]}
        onCreate={() => {}}
        onSelect={() => {}}
      />
    </Dialog>,
    { width: 40, height: 8 },
  );
  await chooser.flush();
  const chooserFrame = chooser.captureCharFrame();
  expect(chooserFrame).toContain("Sessions");
  expect(chooser.renderer.root.findDescendantById("session:search")).toBeDefined();
  act(() => chooser.renderer.destroy());

  const prompt = await testRender(
    <Dialog open>
      <CreatePrompt
        error="Name already exists"
        kind="workspace"
        value="Alpha"
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </Dialog>,
    { width: 40, height: 8 },
  );
  await prompt.flush();
  const promptFrame = prompt.captureCharFrame();
  expect(promptFrame).toContain("Name already exists");
  expect(promptFrame).toContain("Name");
  act(() => prompt.renderer.destroy());
});

test("session create action activates on left mouse release", async () => {
  let createCalls = 0;
  const setup = await testRender(
    <Dialog open>
      <SessionChooser
        canCancel={false}
        sessions={[{ id: "session-1", name: "Main", position: 0 }]}
        onCreate={() => {
          createCalls += 1;
        }}
        onSelect={() => {}}
      />
    </Dialog>,
    { width: 40, height: 8 },
  );
  await setup.flush();
  const create = setup.renderer.root.findDescendantById("session:create");
  expect(create).toBeDefined();

  await act(async () => {
    await setup.mockMouse.pressDown(create!.screenX, create!.screenY);
  });
  expect(createCalls).toBe(0);

  await act(async () => {
    await setup.mockMouse.release(create!.screenX, create!.screenY);
  });
  expect(createCalls).toBe(1);
  act(() => setup.renderer.destroy());
});
