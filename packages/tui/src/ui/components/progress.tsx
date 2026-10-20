import type { BoxProps } from "@/ui/primitives/box";
import { Box } from "@/ui/primitives/box";
import type { ThemeColor } from "@/ui/theming/theme";

export interface ProgressProps extends Omit<BoxProps, "children"> {
  value: number;
  max?: number;
  color?: ThemeColor;
  trackColor?: ThemeColor;
  thin?: boolean;
}

export function Progress({
  value,
  max = 100,
  color = "primary",
  trackColor = "muted",
  thin = false,
  ...props
}: ProgressProps) {
  const progress = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const width = `${progress * 100}%` as `${number}%`;

  if (thin) {
    return (
      <Box width="100%" height={1} flexDirection="row" {...props}>
        {progress > 0 && (
          <Box width={width} height={1} border={["top"]} borderColor={color} flexShrink={0} />
        )}

        {progress < 1 && <Box height={1} border={["top"]} borderColor={trackColor} flexGrow={1} />}
      </Box>
    );
  }

  return (
    <Box width="100%" height={1} bg={trackColor} {...props}>
      {progress > 0 && <Box width={width} height="100%" bg={color} flexShrink={0} />}
    </Box>
  );
}
