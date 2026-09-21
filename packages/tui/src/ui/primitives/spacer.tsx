import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";

export type SpacerProps = Omit<BoxProps, "children">;

export function Spacer({ flexGrow = 1, ...props }: SpacerProps) {
  return <Box {...props} flexGrow={flexGrow} />;
}
