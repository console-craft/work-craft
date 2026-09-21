import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";

export interface HStackProps extends Omit<BoxProps, "flexDirection" | "flexWrap"> {}

export function HStack({ gap = 1, alignItems = "center", ...props }: HStackProps) {
  return <Box {...props} flexDirection="row" gap={gap} alignItems={alignItems} />;
}
