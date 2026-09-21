import { defineTheme } from "@/ui/theme";

export const draculaTheme = defineTheme({
  name: "dracula",

  colors: {
    background: "#282a36",
    foreground: "#f8f8f2",

    primary: "#bd93f9",
    primaryForeground: "#282a36",

    secondary: "#44475a",
    secondaryForeground: "#f8f8f2",

    muted: "#21222c",
    mutedForeground: "#6272a4",

    accent: "#ff79c6",
    accentForeground: "#282a36",

    success: "#50fa7b",
    successForeground: "#282a36",

    warning: "#f1fa8c",
    warningForeground: "#282a36",

    error: "#ff5555",
    errorForeground: "#282a36",

    info: "#8be9fd",
    infoForeground: "#282a36",

    focus: "#6272a4",
    focusForeground: "#f8f8f2",

    selection: "#44475a",
    selectionForeground: "#f8f8f2",

    border: "#44475a",
  },

  borders: {
    default: "rounded",
    strong: "heavy",
  },
});
