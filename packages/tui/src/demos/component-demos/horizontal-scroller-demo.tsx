import { type ReactNode, useContext, useState } from "react";

import { HorizontalScroller } from "@/ui/components/horizontal-scroller";
import { Toggle, ToggleGroup, ToggleGroupContext } from "@/ui/controls/toggle";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

const scrollerLabels = [
  "Inbox",
  "Today",
  "Design",
  "Implementation",
  "Collaboration",
  "Operations",
  "研究 workspace with a label longer than this viewport",
] as const;

function DemoScrollerToggles(): ReactNode {
  const group = useContext(ToggleGroupContext);
  return (
    <HorizontalScroller
      id="horizontal-reveal"
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      revealId={
        group?.focused && group.activeValue
          ? `horizontal-demo-item:${group.activeValue}`
          : undefined
      }
    >
      {scrollerLabels.map((label) => (
        <Toggle key={label} id={`horizontal-demo-item:${label}`} value={label} height={1}>
          {label}
        </Toggle>
      ))}
    </HorizontalScroller>
  );
}

export function HorizontalScrollerDemo(): ReactNode {
  const [selected, setSelected] = useState<string | undefined>("Inbox");
  return (
    <Stack id="horizontal-scroller-demo">
      <Text fg="primary">HORIZONTAL SCROLLER</Text>
      <Text variant="muted">Fits: no arrows</Text>
      <HorizontalScroller id="horizontal-fit" width={40} maxWidth="100%">
        <Text wrapMode="none" flexShrink={0}>
          Everything fits
        </Text>
      </HorizontalScroller>
      <Text variant="muted">Overflow: wheel or arrows; focus stays put</Text>
      <HorizontalScroller id="horizontal-text" width={40} maxWidth="100%">
        <Text id="horizontal-text-label" wrapMode="none" flexShrink={0}>
          研究 workspace — complete labels remain readable with arrows and wheel input
        </Text>
      </HorizontalScroller>
      <Text variant="muted">Reveal: Tab here, browse with ←/→, activate with Enter/Space</Text>
      <ToggleGroup
        id="horizontal-reveal-group"
        type="single"
        value={selected}
        onValueChange={setSelected}
        width={40}
        maxWidth="100%"
        height={1}
        gap={0}
      >
        <DemoScrollerToggles />
      </ToggleGroup>
      <Text id="horizontal-demo-selected">{`Selected: ${selected ?? "None"}`}</Text>
    </Stack>
  );
}
