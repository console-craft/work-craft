import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";

export interface WrapProps extends Omit<BoxProps, "flexDirection" | "flexWrap"> {}

export function Wrap({ gap = 1, alignItems = "center", ...props }: WrapProps) {
  return <Box {...props} flexDirection="row" flexWrap="wrap" gap={gap} alignItems={alignItems} />;
}
