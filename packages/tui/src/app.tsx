import { gruvboxTheme } from "@/lib/terminal-themes/gruvbox";
import { ThemeProvider } from "@/providers/theme-provider";
import { WorkCraftShell } from "./shell/shell.tsx";
import { useWorkCraft } from "./client/use-work-craft.ts";

export function App() {
  return (
    <ThemeProvider theme={gruvboxTheme}>
      <WorkCraftShell workCraft={useWorkCraft()} />
    </ThemeProvider>
  );
}
