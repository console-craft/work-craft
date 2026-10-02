import { expect, test } from "bun:test";

import { TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import { StatusBar } from "@/shell/status-bar";
import { icons } from "@/ui/icons/nerd";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test("status keys use keyboard icons without replacing action descriptions or unknown key names", async () => {
  const { renderer, flush } = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <StatusBar
        mode="LEADER"
        hints={[
          { keys: "Hyper+r", label: "Reconnect" },
          { keys: "leader+b", label: "Toggle navigator" },
          { keys: "Command+Control+Option+Shift+Enter/Space", label: "Activate" },
          { keys: "Cmd+Ctrl+Alt+Return", label: "Submit" },
          { keys: "Super+Meta+Esc", label: "Cancel" },
          { keys: "Tab/Backtab+Backspace", label: "Edit" },
          { keys: "CapsLock+F1/F12+Left/Up/Right/Down", label: "Navigate" },
          { keys: "Hyperdrive+F13+constructor", label: "Control Hyper Space" },
        ]}
      />
    </ThemeProvider>,
    { width: 120, height: 3 },
  );
  try {
    await act(async () => flush());
    const text = renderer.root
      .findDescendantById("status")!
      .getChildren()
      .filter((child): child is TextRenderable => child instanceof TextRenderable)
      .map((child) => child.plainText);
    expect(text[0]).toBe("LEADER");
    expect(text[1]!.replace(/\s+/g, " ").trim()).toBe(
      [
        `${icons.keyboard} r Reconnect`,
        `${icons.space} b Toggle navigator`,
        `${icons.command} ${icons.control} ${icons.option} ${icons.shift} ${icons.return}/${icons.space} Activate`,
        `${icons.command} ${icons.control} ${icons.option} ${icons.return} Submit`,
        `${icons.command} ${icons.option} ${icons.escape} Cancel`,
        `${icons.tab}/${icons.tabReverse} ${icons.backspace} Edit`,
        `${icons.capsLock} ${icons.f1}/${icons.f12} ${icons.arrowLeft}/${icons.arrowUp}/${icons.arrowRight}/${icons.arrowDown} Navigate`,
        "Hyperdrive F13 constructor Control Hyper Space",
      ].join(" "),
    );
  } finally {
    act(() => renderer.destroy());
  }
});
