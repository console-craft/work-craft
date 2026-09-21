import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";

export interface StackProps extends Omit<BoxProps, "flexDirection" | "flexWrap"> {}

export function Stack({ gap = 1, ...props }: StackProps) {
  return <Box {...props} flexDirection="column" gap={gap} />;
}
