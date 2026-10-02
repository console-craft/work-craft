import { useWorkCraft } from "@/client/use-work-craft.ts";
import { WorkCraftShell } from "@/shell/shell.tsx";
import { ThemeProvider } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";

export function App() {
  return (
    <ThemeProvider theme={defaultTheme}>
      <WorkCraftShell workCraft={useWorkCraft()} />
    </ThemeProvider>
  );
}
