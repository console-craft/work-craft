import { defaultTextareaKeyBindings, type TextareaRenderable } from "@opentui/core";
import type { TextareaProps as OpenTUITextareaProps } from "@opentui/react";
import { useCallback, useLayoutEffect, useRef } from "react";

import { nativeActionHints, useControlHints } from "@/ui/control-hints";
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

const defaultKeyBindings = [
  { name: "return", shift: true, action: "newline" },
  {
    name: "return",
    ctrl: true,
    action: "submit",
  },
] satisfies NonNullable<OpenTUITextareaProps["keyBindings"]>;

export interface TextareaProps
  extends Omit<OpenTUITextareaProps, keyof ThemedColorProps>, ThemedColorProps {
  disabled?: boolean;
}

export function Textarea({
  ref,
  disabled = false,
  focused,

  backgroundColor = "muted",
  textColor = "foreground",
  focusedBackgroundColor = "muted",
  focusedTextColor = "foreground",

  placeholderColor = "mutedForeground",
  cursorColor = "foreground",
  selectionBg = "selection",
  selectionFg = "selectionForeground",
  tabIndicatorColor = "mutedForeground",

  keyBindings = [],
  keyAliasMap,
  onSubmit,
  ...props
}: TextareaProps) {
  const theme = useTheme();
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const effectiveBindings = [...defaultKeyBindings, ...keyBindings];
  useControlHints(
    textareaRef,
    !disabled && onSubmit
      ? nativeActionHints(
          [...defaultTextareaKeyBindings, ...effectiveBindings],
          "submit",
          "Submit",
          keyAliasMap,
        )
      : [],
  );

  const setTextareaRef = useCallback(
    (node: TextareaRenderable | null) => {
      textareaRef.current = node;
      assignRef(ref, node);

      return () => {
        if (textareaRef.current === node) {
          textareaRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    setDisabled(textareaRef.current, disabled);
  }, [disabled]);

  return (
    <textarea
      {...props}
      onSubmit={onSubmit}
      keyAliasMap={keyAliasMap}
      ref={setTextareaRef}
      focused={disabled ? false : focused}
      backgroundColor={resolveColor(theme, disabled ? "secondary" : backgroundColor)}
      textColor={resolveColor(theme, disabled ? "mutedForeground" : textColor)}
      focusedBackgroundColor={resolveColor(theme, disabled ? "muted" : focusedBackgroundColor)}
      focusedTextColor={resolveColor(theme, disabled ? "mutedForeground" : focusedTextColor)}
      placeholderColor={resolveColor(theme, disabled ? "mutedForeground" : placeholderColor)}
      cursorColor={resolveColor(theme, disabled ? "mutedForeground" : cursorColor)}
      selectionBg={resolveColor(theme, selectionBg)}
      selectionFg={resolveColor(theme, selectionFg)}
      tabIndicatorColor={resolveColor(theme, disabled ? "mutedForeground" : tabIndicatorColor)}
      keyBindings={effectiveBindings}
    />
  );
}
