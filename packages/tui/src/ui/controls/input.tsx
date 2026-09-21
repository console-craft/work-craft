import type { InputRenderable } from "@opentui/core";
import type { InputProps as OpenTUIInputProps } from "@opentui/react";
import { useCallback, useLayoutEffect, useRef } from "react";

import { resolveColor, type ThemeColor } from "@/ui/theme";
import { useTheme } from "@/ui/theme-provider";
import { assignRef, setDisabled } from "@/ui/utils";

type ThemedColorProps = {
  backgroundColor?: ThemeColor;
  textColor?: ThemeColor;
  focusedBackgroundColor?: ThemeColor;
  focusedTextColor?: ThemeColor;
  placeholderColor?: ThemeColor;
  cursorColor?: ThemeColor;
  selectionBg?: ThemeColor;
  selectionFg?: ThemeColor;
  tabIndicatorColor?: ThemeColor;
};

type InputEventProps = {
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
};

export interface InputProps
  extends
    Omit<OpenTUIInputProps, keyof ThemedColorProps | keyof InputEventProps>,
    ThemedColorProps,
    InputEventProps {
  disabled?: boolean;
}

export function Input({
  ref,
  disabled = false,
  focused,
  onSubmit,

  backgroundColor = "muted",
  textColor = "foreground",
  focusedBackgroundColor = "muted",
  focusedTextColor = "foreground",

  placeholderColor = "mutedForeground",
  cursorColor = "foreground",
  selectionBg = "selection",
  selectionFg = "selectionForeground",
  tabIndicatorColor,

  ...props
}: InputProps) {
  const theme = useTheme();
  const inputRef = useRef<InputRenderable | null>(null);

  const setInputRef = useCallback(
    (node: InputRenderable | null) => {
      inputRef.current = node;
      assignRef(ref, node);

      return () => {
        if (inputRef.current === node) {
          inputRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    setDisabled(inputRef.current, disabled);
  }, [disabled]);

  const currentBackgroundColor = disabled ? "secondary" : backgroundColor;

  const currentTextColor = disabled ? "mutedForeground" : textColor;

  const currentPlaceholderColor = disabled ? "mutedForeground" : placeholderColor;

  const currentCursorColor = disabled ? "mutedForeground" : cursorColor;

  return (
    <input
      {...props}
      // OpenTUI React emits a string, but its types also inherit the native SubmitEvent callback.
      onSubmit={onSubmit as OpenTUIInputProps["onSubmit"]}
      ref={setInputRef}
      focused={disabled ? false : focused}
      backgroundColor={resolveColor(theme, currentBackgroundColor)}
      textColor={resolveColor(theme, currentTextColor)}
      focusedBackgroundColor={resolveColor(theme, disabled ? "muted" : focusedBackgroundColor)}
      focusedTextColor={resolveColor(theme, disabled ? "mutedForeground" : focusedTextColor)}
      placeholderColor={resolveColor(theme, currentPlaceholderColor)}
      cursorColor={resolveColor(theme, currentCursorColor)}
      selectionBg={resolveColor(theme, selectionBg)}
      selectionFg={resolveColor(theme, selectionFg)}
      tabIndicatorColor={
        tabIndicatorColor === undefined ? undefined : resolveColor(theme, tabIndicatorColor)
      }
    />
  );
}
