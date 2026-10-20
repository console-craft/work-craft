import { expect, test } from "bun:test";

import { TextRenderable } from "@opentui/core";
import { act } from "react";

import { SessionSwitcher } from "@/shell/session-switcher.tsx";
import { testRender } from "@/shell/tests/fixtures";
import { icons } from "@/ui/icons/nerd";

test.each([
  ["Work", "Work"],
  [null, "Select session..."],
  ["工作", "工作"],
  ["A long session name", "A long session name"],
] as const)(
  "session switcher shows an account icon before the full session label (%s)",
  async (name, label) => {
    let opened = 0;
    const setup = await testRender(
      <SessionSwitcher name={name} status="connected" focused={false} onOpen={() => opened++} />,
      { width: 40, height: 3 },
    );
    try {
      await setup.flush();
      const session = setup.renderer.root.findDescendantById("region:session")!;
      const account = session.getChildren()[0] as TextRenderable;
      const text = session.getChildren()[1] as TextRenderable;
      const indicator = setup.renderer.root.findDescendantById("connection-status")!;
      expect(account.plainText).toBe(icons.account);
      expect(text.plainText).toBe(label);
      expect(account.screenY).toBe(session.screenY);
      expect(text.screenX).toBe(account.screenX + account.width + 1);
      expect(indicator.screenY).toBe(session.screenY);
      expect(indicator.screenX).toBe(text.screenX + text.width + 1);
      expect(setup.captureCharFrame()).not.toContain("Session:");
      await act(async () => setup.mockMouse.click(account.screenX, account.screenY));
      expect(opened).toBe(1);
    } finally {
      act(() => setup.renderer.destroy());
    }
  },
);
