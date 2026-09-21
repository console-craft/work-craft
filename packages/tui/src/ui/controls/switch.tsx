import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent as OpenTUIMouseEvent,
  RenderableEvents,
} from "@opentui/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { symbols } from "@/ui/icons/symbols";
import { HStack, type HStackProps } from "@/ui/primitives/hstack";
import { Text, type TextProps } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theme";
import { assignRef } from "@/ui/utils";

export interface SwitchProps extends Omit<HStackProps, "children" | "focusable"> {
  checked?: boolean;
  disabled?: boolean;
  indicatorPosition?: "start" | "end";

  onColor?: ThemeColor;
  offColor?: ThemeColor;
  offColorFocused?: ThemeColor;
  disabledColor?: ThemeColor;

  onCheckedChange?: (checked: boolean) => void;
  children?: TextProps["children"];
}

export function Switch({
  children,
  ref,
  checked = false,
  disabled = false,
  indicatorPosition = "end",

  onColor = "selection",
  offColor = "mutedForeground",
  offColorFocused = "foreground",
  disabledColor = "secondary",

  width = "100%",
  justifyContent,

  bg,
  focused,
  onCheckedChange,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseOut,
  ...props
}: SwitchProps) {
  const switchRef = useRef<BoxRenderable | null>(null);
  const mousePressedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);

  const setSwitchRef = useCallback(
    (node: BoxRenderable | null) => {
      switchRef.current = node;
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

        if (switchRef.current === node) {
          switchRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (!disabled) return;

    mousePressedRef.current = false;

    const switchControl = switchRef.current;

    if (!switchControl?.focused) return;

    switchControl.focusable = true;
    switchControl.blur();
    switchControl.focusable = false;
  }, [disabled]);

  const indicator = checked
    ? `${symbols.square}${symbols.squareFilled}`
    : `${symbols.squareFilled}${symbols.square}`;

  const notCheckedFocused = !checked && isFocused;

  const indicatorColor = disabled
    ? disabledColor
    : checked
      ? onColor
      : notCheckedFocused
        ? offColorFocused
        : offColor;

  const labelColor = disabled ? disabledColor : isFocused ? "focusForeground" : "foreground";

  const resolvedJustifyContent =
    justifyContent ?? (indicatorPosition === "end" ? "space-between" : "flex-start");

  function toggle() {
    onCheckedChange?.(!checked);
  }

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (
      event.defaultPrevented ||
      disabled ||
      event.repeated ||
      !onCheckedChange ||
      event.name !== "space"
    ) {
      return;
    }

    event.preventDefault();
    toggle();
  }

  function handleMouseDown(this: BoxRenderable, event: OpenTUIMouseEvent) {
    onMouseDown?.call(this, event);

    if (
      event.defaultPrevented ||
      disabled ||
      !onCheckedChange ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }

    mousePressedRef.current = true;
  }

  function handleMouseUp(this: BoxRenderable, event: OpenTUIMouseEvent) {
    const wasPressed = mousePressedRef.current;
    mousePressedRef.current = false;

    onMouseUp?.call(this, event);

    if (
      event.defaultPrevented ||
      disabled ||
      !onCheckedChange ||
      !wasPressed ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }

    toggle();
  }

  function handleMouseOut(this: BoxRenderable, event: OpenTUIMouseEvent) {
    mousePressedRef.current = false;
    onMouseOut?.call(this, event);
  }

  return (
    <HStack
      {...props}
      ref={setSwitchRef}
      width={width}
      justifyContent={resolvedJustifyContent}
      focusable={!disabled}
      focused={disabled ? false : focused}
      bg={isFocused ? "focus" : bg}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      {/* <Text>{resolvedJustifyContent}</Text> */}
      {indicatorPosition === "start" && <Text fg={indicatorColor}>{indicator}</Text>}

      <Text fg={labelColor}>{children}</Text>

      {indicatorPosition === "end" && <Text fg={indicatorColor}>{indicator}</Text>}
    </HStack>
  );
}
