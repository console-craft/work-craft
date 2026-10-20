import { defineTheme } from "@/ui/theming/theme";

export const catppuccinTheme = defineTheme({
  name: "catppuccin",

  colors: {
    // Catppuccin Mocha
    background: "#1e1e2e",
    foreground: "#cdd6f4",

    primary: "#89b4fa",
    primaryForeground: "#1e1e2e",

    secondary: "#313244",
    secondaryForeground: "#cdd6f4",

    muted: "#181825",
    mutedForeground: "#6c7086",

    accent: "#cba6f7",
    accentForeground: "#1e1e2e",

    success: "#a6e3a1",
    successForeground: "#1e1e2e",

    warning: "#f9e2af",
    warningForeground: "#1e1e2e",

    error: "#f38ba8",
    errorForeground: "#1e1e2e",

    info: "#89dceb",
    infoForeground: "#1e1e2e",

    focus: "#b4befe",
    focusForeground: "#1e1e2e",

    selection: "#585b70",
    selectionForeground: "#cdd6f4",

    border: "#45475a",
  },

  borders: {
    default: "rounded",
    strong: "heavy",
  },
});
