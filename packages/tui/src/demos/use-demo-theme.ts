import { useKeyboard } from "@opentui/react";
import { useState } from "react";

import type { Theme } from "@/ui/theming/theme";
import { catppuccinTheme } from "@/ui/theming/themes/catppuccin";
import { defaultTheme } from "@/ui/theming/themes/default";
import { draculaTheme } from "@/ui/theming/themes/dracula";
import { nordTheme } from "@/ui/theming/themes/nord";
import { tokyoNightTheme } from "@/ui/theming/themes/tokyo-night";

const themes = [defaultTheme, catppuccinTheme, draculaTheme, nordTheme, tokyoNightTheme];

/** Cycles demo themes with Ctrl+t without remounting their controls. */
export function useDemoTheme(): Theme {
  const [index, setIndex] = useState(0);
  useKeyboard((key) => {
    if (
      key.defaultPrevented ||
      key.repeated ||
      key.name !== "t" ||
      !key.ctrl ||
      key.shift ||
      key.meta ||
      key.option ||
      key.super ||
      key.hyper
    ) {
      return;
    }
    key.preventDefault();
    setIndex((current) => (current + 1) % themes.length);
  });
  return themes[index];
}
