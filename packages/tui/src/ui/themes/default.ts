import { defineTheme } from "@/ui/theme";

export const defaultTheme = defineTheme({
  name: "default",

  colors: {
    background: "#33302e",
    foreground: "#d4be98",

    primary: "#adb79d",
    primaryForeground: "#33302e",

    secondary: "#4c4641",
    secondaryForeground: "#d4be98",

    muted: "#2a2928",
    mutedForeground: "#695e55",

    accent: "#eead83",
    accentForeground: "#33302e",

    success: "#bac584",
    successForeground: "#33302e",

    warning: "#d6b37b",
    warningForeground: "#33302e",

    error: "#ea6962",
    errorForeground: "#2a2928",

    info: "#b2ba8e",
    infoForeground: "#33302e",

    focus: "#695e55",
    focusForeground: "#d4be98",

    selection: "#d6b37b",
    selectionForeground: "#33302e",

    border: "#4c4641",
  },

  borders: {
    default: "rounded",
    strong: "heavy",
  },
});
