import { Children, type ReactNode } from "react";

import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";

export interface GridProps extends Omit<
  BoxProps,
  "children" | "flexDirection" | "flexWrap" | "alignItems"
> {
  columns: number;
  children?: ReactNode;
}

export function Grid({ columns, children, gap = 1, rowGap, columnGap, ...props }: GridProps) {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error("Grid columns must be a positive integer");
  }

  const items = Children.toArray(children);
  const rows = [];

  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }

  return (
    <Box {...props} flexDirection="column" alignItems="stretch" gap={rowGap ?? gap}>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" gap={columnGap ?? gap}>
          {Array.from({ length: columns }, (_, columnIndex) => {
            const child = row[columnIndex];

            return (
              <Box key={columnIndex} flexBasis={0} flexGrow={1}>
                {child}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
