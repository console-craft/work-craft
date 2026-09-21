import {
  type KeyEvent,
  RenderableEvents,
  type SelectKeyBinding,
  type SelectRenderable,
} from "@opentui/core";
import type { SelectProps as OpenTUISelectProps } from "@opentui/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { resolveColor, type ThemeColor } from "@/ui/theme";
import { useTheme } from "@/ui/theme-provider";
import { assignRef, setDisabled } from "@/ui/utils";

const defaultKeyBindings: SelectKeyBinding[] = [
  { name: "l", action: "move-down" },
  { name: "h", action: "move-up" },
  { name: "n", ctrl: true, action: "move-down" },
  { name: "p", ctrl: true, action: "move-up" },
  { name: "d", ctrl: true, action: "move-down-fast" },
  { name: "u", ctrl: true, action: "move-up-fast" },
];

type ThemedColorProps = {
  backgroundColor?: ThemeColor;
  textColor?: ThemeColor;
  descriptionColor?: ThemeColor;
  focusedBackgroundColor?: ThemeColor;
  focusedTextColor?: ThemeColor;
  selectedBackgroundColor?: ThemeColor;
  selectedTextColor?: ThemeColor;
  selectedDescriptionColor?: ThemeColor;
  focusedSelectedBackgroundColor?: ThemeColor;
  focusedSelectedTextColor?: ThemeColor;
  focusedSelectedDescriptionColor?: ThemeColor;
};

export interface SelectProps
  extends Omit<OpenTUISelectProps, keyof ThemedColorProps>, ThemedColorProps {
  disabled?: boolean;
}

export function Select({
  ref,
  disabled = false,
  focused,

  backgroundColor = "muted",
  textColor = "foreground",
  descriptionColor = "mutedForeground",

  focusedBackgroundColor = "muted",
  focusedTextColor = "foreground",

  selectedBackgroundColor = "primary",
  selectedTextColor = "primaryForeground",
  selectedDescriptionColor = "mutedForeground",

  focusedSelectedBackgroundColor = "focus",
  focusedSelectedTextColor = "primary",
  focusedSelectedDescriptionColor = "primaryForeground",

  keyBindings = [],
  onKeyDown,

  ...props
}: SelectProps) {
  const theme = useTheme();
  const selectRef = useRef<SelectRenderable | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const setSelectRef = useCallback(
    (node: SelectRenderable | null) => {
      selectRef.current = node;
      assignRef(ref, node);

      if (!node) return;

      setIsFocused(node.focused);

      const handleFocus = () => setIsFocused(true);
      const handleBlur = () => setIsFocused(false);

      node.on(RenderableEvents.FOCUSED, handleFocus);
      node.on(RenderableEvents.BLURRED, handleBlur);

      return () => {
        node.off(RenderableEvents.FOCUSED, handleFocus);
        node.off(RenderableEvents.BLURRED, handleBlur);

        if (selectRef.current === node) {
          selectRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    setDisabled(selectRef.current, disabled);
  }, [disabled]);

  const effectiveFocused = isFocused && !disabled;

  const currentSelectedBackgroundColor = disabled
    ? "secondary"
    : effectiveFocused
      ? focusedSelectedBackgroundColor
      : selectedBackgroundColor;

  const currentSelectedTextColor = disabled
    ? "mutedForeground"
    : effectiveFocused
      ? focusedSelectedTextColor
      : selectedTextColor;

  const currentSelectedDescriptionColor = disabled
    ? "mutedForeground"
    : effectiveFocused
      ? focusedSelectedDescriptionColor
      : selectedDescriptionColor;

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    const isG = event.name.toLowerCase() === "g";

    if (!isG || event.ctrl || event.meta || event.super) {
      return;
    }

    const select = selectRef.current;

    if (!select || select.options.length === 0) {
      return;
    }

    event.preventDefault();

    const isLast = event.shift || event.name === "G";

    select.setSelectedIndex(isLast ? select.options.length - 1 : 0);
  }

  return (
    <select
      {...props}
      ref={setSelectRef}
      focused={disabled ? false : focused}
      backgroundColor={resolveColor(theme, disabled ? "muted" : backgroundColor)}
      textColor={resolveColor(theme, disabled ? "mutedForeground" : textColor)}
      focusedBackgroundColor={resolveColor(theme, disabled ? "muted" : focusedBackgroundColor)}
      focusedTextColor={resolveColor(theme, disabled ? "mutedForeground" : focusedTextColor)}
      selectedBackgroundColor={resolveColor(theme, currentSelectedBackgroundColor)}
      selectedTextColor={resolveColor(theme, currentSelectedTextColor)}
      descriptionColor={resolveColor(theme, disabled ? "mutedForeground" : descriptionColor)}
      selectedDescriptionColor={resolveColor(theme, currentSelectedDescriptionColor)}
      keyBindings={[...defaultKeyBindings, ...keyBindings]}
      onKeyDown={handleKeyDown}
    />
  );
}
