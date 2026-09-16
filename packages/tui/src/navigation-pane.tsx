import { Panel } from "@/components/ui/panel";
import type { NavigationEntry } from "./navigation.ts";

export type NavigationPaneProps = {
  entries: NavigationEntry[];
  selectedIndex: number;
};

export function NavigationPane({ entries, selectedIndex }: NavigationPaneProps) {
  return (
    <Panel title="Work">
      <box flexDirection="column">
        {entries.map(({ node, depth }, index) => (
          <text key={node.key} fg={index === selectedIndex ? "#FFFFFF" : "#9CA3AF"}>
            {`${index === selectedIndex ? ">" : " "} ${"  ".repeat(depth)}${node.label}`}
          </text>
        ))}
      </box>
    </Panel>
  );
}
