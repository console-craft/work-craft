import type { ReactNode } from "react";

import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theming/theme";
import { isTextContent, textTransform, type TextTransform } from "@/ui/utils";

export type BadgeColor =
  | "primary"
  | "secondary"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info";

const foregroundColors = {
  primary: "primaryForeground",
  secondary: "secondaryForeground",
  muted: "focus",
  accent: "accentForeground",
  success: "successForeground",
  warning: "warningForeground",
  error: "errorForeground",
  info: "infoForeground",
} satisfies Record<BadgeColor, ThemeColor>;

export interface BadgeProps extends Omit<HStackProps, "children" | "color"> {
  children: ReactNode;
  color?: BadgeColor;
  transform?: TextTransform;
}

export function Badge({ children, color = "secondary", transform = "none", ...props }: BadgeProps) {
  const content = typeof children === "string" ? textTransform(children, transform) : children;

  return (
    <HStack bg={color} paddingX={1} gap={1} alignSelf="flex-start" {...props}>
      {isTextContent(content) ? <Text fg={foregroundColors[color]}>{content}</Text> : content}
    </HStack>
  );
}
