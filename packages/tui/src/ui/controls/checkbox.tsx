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
import { assignRef } from "@/ui/utils";

export interface CheckboxProps extends Omit<HStackProps, "children" | "focusable"> {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  children?: TextProps["children"];
}

export function Checkbox({
  children,
  ref,
  checked = false,
  indeterminate = false,
  disabled = false,
  bg,
  focused,
  onCheckedChange,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseOut,
  ...props
}: CheckboxProps) {
  const checkboxRef = useRef<BoxRenderable | null>(null);
  const mousePressedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);

  const setCheckboxRef = useCallback(
    (node: BoxRenderable | null) => {
      checkboxRef.current = node;
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

        if (checkboxRef.current === node) {
          checkboxRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (!disabled) return;

    mousePressedRef.current = false;

    const checkbox = checkboxRef.current;

    if (!checkbox?.focused) return;

    checkbox.focusable = true;
    checkbox.blur();
    checkbox.focusable = false;
  }, [disabled]);

  const symbol = indeterminate
    ? symbols.squareIndeterminate
    : checked
      ? symbols.squareChecked
      : symbols.square;

  const labelColor = disabled ? "mutedForeground" : isFocused ? "focusForeground" : "foreground";

  const indicatorColor = disabled ? "mutedForeground" : "selection";

  function toggle() {
    onCheckedChange?.(indeterminate ? true : !checked);
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
      ref={setCheckboxRef}
      focusable={!disabled}
      focused={disabled ? false : focused}
      bg={isFocused ? "focus" : bg}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Text fg={indicatorColor}>{symbol}</Text>
      <Text fg={labelColor}>{children}</Text>
    </HStack>
  );
}
