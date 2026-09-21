import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";

export type DividerOrientation = "horizontal" | "vertical";

export interface DividerProps extends Omit<BoxProps, "children" | "border" | "alignSelf"> {
  orientation?: DividerOrientation;
}

export function Divider({ orientation = "horizontal", flexShrink = 0, ...props }: DividerProps) {
  return (
    <Box
      {...props}
      border={orientation === "horizontal" ? ["top"] : ["left"]}
      flexShrink={flexShrink}
      alignSelf="stretch"
    />
  );
}
