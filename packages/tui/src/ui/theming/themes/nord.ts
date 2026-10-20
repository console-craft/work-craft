import { defineTheme } from "@/ui/theming/theme";

export const nordTheme = defineTheme({
  name: "nord",

  colors: {
    background: "#2e3440",
    foreground: "#d8dee9",

    primary: "#88c0d0",
    primaryForeground: "#2e3440",

    secondary: "#3b4252",
    secondaryForeground: "#d8dee9",

    muted: "#3b4252",
    mutedForeground: "#4c566a",

    accent: "#b48ead",
    accentForeground: "#2e3440",

    success: "#a3be8c",
    successForeground: "#2e3440",

    warning: "#ebcb8b",
    warningForeground: "#2e3440",

    error: "#bf616a",
    errorForeground: "#2e3440",

    info: "#81a1c1",
    infoForeground: "#2e3440",

    focus: "#5e81ac",
    focusForeground: "#eceff4",

    selection: "#434c5e",
    selectionForeground: "#eceff4",

    border: "#4c566a",
  },

  borders: {
    default: "rounded",
    strong: "heavy",
  },
});
