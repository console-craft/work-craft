import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";

export type ContainerSize = "sm" | "md" | "lg" | "full";

const containerWidths = {
  sm: 80,
  md: 120,
  lg: 160,
  full: "100%",
} as const satisfies Record<ContainerSize, NonNullable<StackProps["maxWidth"]>>;

export interface ContainerProps extends StackProps {
  size?: ContainerSize;
}

export function Container({
  size = "md",
  width = "100%",
  maxWidth,
  marginX = "auto",
  paddingX = 1,
  ...props
}: ContainerProps) {
  return (
    <Stack
      width={width}
      maxWidth={maxWidth ?? containerWidths[size]}
      minWidth={size === "full" ? "100%" : (maxWidth ?? containerWidths[size])}
      marginX={marginX}
      paddingX={paddingX}
      {...props}
    />
  );
}
