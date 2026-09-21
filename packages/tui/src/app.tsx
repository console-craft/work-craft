import { useWorkCraft } from "@/client/use-work-craft.ts";
import { WorkCraftShell } from "@/shell/shell.tsx";
import { FocusManager } from "@/ui/focus-manager.tsx";
import { ThemeProvider } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";

export function App() {
  return (
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="dialog-overlay" />
      <WorkCraftShell workCraft={useWorkCraft()} />
    </ThemeProvider>
  );
}
