import type { BoxOptions, ColorInput } from "@opentui/core";

export type BorderStyle = NonNullable<BoxOptions["borderStyle"]>;

export interface ColorTokens {
  background: ColorInput;
  foreground: ColorInput;

  primary: ColorInput;
  primaryForeground: ColorInput;

  secondary: ColorInput;
  secondaryForeground: ColorInput;

  muted: ColorInput;
  mutedForeground: ColorInput;

  accent: ColorInput;
  accentForeground: ColorInput;

  success: ColorInput;
  successForeground: ColorInput;

  warning: ColorInput;
  warningForeground: ColorInput;

  error: ColorInput;
  errorForeground: ColorInput;

  info: ColorInput;
  infoForeground: ColorInput;

  focus: ColorInput;
  focusForeground: ColorInput;

  selection: ColorInput;
  selectionForeground: ColorInput;

  border: ColorInput;
}

export interface BorderTokens {
  default: BorderStyle;
  strong: BorderStyle;
}

export interface Theme {
  name: string;
  colors: ColorTokens;
  borders: BorderTokens;
}

export type ColorToken = keyof ColorTokens;
export type BorderToken = keyof BorderTokens;

export const defineTheme = <const T extends Theme>(theme: T): T => theme;

export type ThemeColor = ColorToken | ColorInput;

export function resolveColor(theme: Theme, value: ThemeColor): ColorInput;

export function resolveColor(theme: Theme, value: ThemeColor | undefined): ColorInput | undefined;

export function resolveColor(theme: Theme, value: ThemeColor | undefined): ColorInput | undefined {
  if (typeof value === "string" && value in theme.colors) {
    return theme.colors[value as ColorToken];
  }

  return value;
}
