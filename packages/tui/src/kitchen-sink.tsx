import { Badge } from "@/components/ui/badge";
import { gruvboxTheme } from "@/lib/terminal-themes/gruvbox";
import { ThemeProvider } from "@/providers/theme-provider";

export function TermcnKitchenSink() {
  return (
    <ThemeProvider theme={gruvboxTheme}>
      <scrollbox scrollY scrollX={false} flexGrow={1}>
        <box flexDirection="column" alignItems="flex-start" gap={1} padding={1}>
          <Badge>Badge</Badge>
        </box>
      </scrollbox>
    </ThemeProvider>
  );
}
