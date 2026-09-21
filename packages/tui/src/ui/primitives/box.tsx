import type { BoxProps as OpenTUIBoxProps } from "@opentui/react";

import { resolveColor, type ThemeColor } from "@/ui/theme";
import { useTheme } from "@/ui/theme-provider";

type ThemedColorProps = {
  bg?: ThemeColor;
  borderColor?: ThemeColor;
  focusedBorderColor?: ThemeColor;
  titleColor?: ThemeColor;
};

export interface BoxProps
  extends Omit<OpenTUIBoxProps, "backgroundColor" | keyof ThemedColorProps>, ThemedColorProps {}

export function Box({
  children,
  bg,
  border,
  borderColor,
  borderStyle,
  focusedBorderColor,
  titleColor,
  ...props
}: BoxProps) {
  const theme = useTheme();

  const hasBorder =
    Boolean(border) ||
    borderStyle !== undefined ||
    borderColor !== undefined ||
    focusedBorderColor !== undefined ||
    props.customBorderChars !== undefined;

  return (
    <box
      {...props}
      border={border}
      borderStyle={
        borderStyle ??
        (hasBorder && props.customBorderChars === undefined ? theme.borders.default : undefined)
      }
      backgroundColor={resolveColor(theme, bg)}
      borderColor={resolveColor(theme, borderColor ?? (hasBorder ? "border" : undefined))}
      focusedBorderColor={resolveColor(
        theme,
        focusedBorderColor ?? (hasBorder ? "focus" : undefined),
      )}
      titleColor={resolveColor(theme, titleColor)}
    >
      {children}
    </box>
  );
}
