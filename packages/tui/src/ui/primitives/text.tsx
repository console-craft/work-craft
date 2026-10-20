import { TextAttributes } from "@opentui/core";
import type { TextProps as OpenTUITextProps } from "@opentui/react";

import { resolveColor, type Theme, type ThemeColor } from "@/ui/theming/theme";
import { useTheme } from "@/ui/theming/theme-provider";
import { textTransform } from "@/ui/utils";

export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

export type TextVariant =
  | "default"
  | "muted"
  | "heading"
  | "label"
  | "success"
  | "warning"
  | "error"
  | "info";

type ThemedColorProps = {
  fg?: ThemeColor;
  bg?: ThemeColor;
  selectionBg?: ThemeColor;
  selectionFg?: ThemeColor;
  tabIndicatorColor?: ThemeColor;
};

export interface TextProps
  extends Omit<OpenTUITextProps, keyof ThemedColorProps>, ThemedColorProps {
  variant?: TextVariant;
  transform?: TextTransform;
}

function getVariantProps(theme: Theme, variant: TextVariant): Pick<TextProps, "fg" | "attributes"> {
  switch (variant) {
    case "muted":
      return {
        fg: theme.colors.mutedForeground,
      };

    case "heading":
      return {
        fg: theme.colors.primary,
        attributes: TextAttributes.BOLD,
      };
    case "label":
      return {
        fg: theme.colors.foreground,
        attributes: TextAttributes.BOLD,
      };

    case "success":
      return { fg: theme.colors.success };

    case "warning":
      return { fg: theme.colors.warning };

    case "error":
      return { fg: theme.colors.error };

    case "info":
      return { fg: theme.colors.info };

    default:
      return { fg: theme.colors.foreground };
  }
}

export function Text({
  children,
  variant = "default",
  transform = "none",
  fg,
  bg,
  selectionBg,
  selectionFg,
  tabIndicatorColor,
  attributes,
  ...props
}: TextProps) {
  const theme = useTheme();
  const variantProps = getVariantProps(theme, variant);

  const transformedChildren =
    typeof children === "string" ? textTransform(children, transform) : children;

  return (
    <text
      {...props}
      fg={resolveColor(theme, fg ?? variantProps.fg)}
      bg={resolveColor(theme, bg)}
      selectionBg={resolveColor(theme, selectionBg ?? "selection")}
      selectionFg={resolveColor(theme, selectionFg ?? "selectionForeground")}
      tabIndicatorColor={resolveColor(theme, tabIndicatorColor)}
      attributes={attributes ?? variantProps.attributes}
    >
      {transformedChildren}
    </text>
  );
}
