import { defineTheme } from "@/ui/theming/theme";

export const tokyoNightTheme = defineTheme({
  name: "tokyo-night",

  colors: {
    background: "#1a1b26",
    foreground: "#c0caf5",

    primary: "#7aa2f7",
    primaryForeground: "#1a1b26",

    secondary: "#24283b",
    secondaryForeground: "#c0caf5",

    muted: "#16161e",
    mutedForeground: "#565f89",

    accent: "#bb9af7",
    accentForeground: "#1a1b26",

    success: "#9ece6a",
    successForeground: "#1a1b26",

    warning: "#e0af68",
    warningForeground: "#1a1b26",

    error: "#f7768e",
    errorForeground: "#1a1b26",

    info: "#7dcfff",
    infoForeground: "#1a1b26",

    focus: "#3d59a1",
    focusForeground: "#c0caf5",

    selection: "#283457",
    selectionForeground: "#c0caf5",

    border: "#292e42",
  },

  borders: {
    default: "rounded",
    strong: "heavy",
  },
});
