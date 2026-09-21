import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";

type CenterDirection =
  | {
      horizontal?: boolean;
      vertical?: never;
    }
  | {
      horizontal?: never;
      vertical?: boolean;
    };

export type CenterProps = Omit<BoxProps, "flexDirection" | "alignItems" | "justifyContent"> &
  CenterDirection;

export function Center({ horizontal, vertical, ...props }: CenterProps) {
  const both = !horizontal && !vertical;

  return (
    <Box
      {...props}
      flexDirection="column"
      alignItems={both || horizontal ? "center" : undefined}
      justifyContent={both || vertical ? "center" : undefined}
    />
  );
}
