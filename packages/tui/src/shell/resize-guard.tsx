import type { ReactNode } from "react";

import { Box } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";

/** Application mask, not a modal: leave the final status row untouched. */
export function ResizeGuard({ width, height }: { width: number; height: number }): ReactNode {
  return (
    <Box
      id="resize-guard"
      position="absolute"
      left={0}
      top={0}
      width={Math.max(0, width)}
      height={Math.max(0, height - 1)}
      visible={width > 0 && height > 1}
      zIndex={2000}
      bg="background"
      overflow="hidden"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseScroll={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Text>Please resize your terminal</Text>
      <Text>{`Work Craft requires at least 80 columns. Current width: ${width}.`}</Text>
    </Box>
  );
}
