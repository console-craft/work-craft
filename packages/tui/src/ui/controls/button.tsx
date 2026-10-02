import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent as OpenTUIMouseEvent,
  RenderableEvents,
} from "@opentui/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useControlHints } from "@/ui/control-hints";
import { Box, type BoxProps } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theme";
import { assignRef } from "@/ui/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const activate = {
  names: ["return", "linefeed", "space"],
  hint: { keys: "Enter/Space", label: "Activate" },
};

type ButtonVisual = {
  bg?: ThemeColor;
  fg: ThemeColor;
};

const buttonVariants: Record<ButtonVariant, ButtonVisual> = {
  primary: {
    bg: "primary",
    fg: "primaryForeground",
  },
  secondary: {
    bg: "secondary",
    fg: "secondaryForeground",
  },
  ghost: {
    fg: "foreground",
  },
  destructive: {
    bg: "error",
    fg: "errorForeground",
  },
};

export interface ButtonProps extends Omit<BoxProps, "focusable"> {
  variant?: ButtonVariant;
  disabled?: boolean;
  fg?: ThemeColor;
  onPress?: () => void;
}

export function Button({
  children,
  ref,

  variant = "primary",
  disabled = false,

  bg,
  fg,

  focused,
  flexDirection = "row",
  alignItems = "center",
  justifyContent = "center",
  paddingX = 1,

  onPress,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseOut,

  ...props
}: ButtonProps) {
  const buttonRef = useRef<BoxRenderable | null>(null);
  useControlHints(buttonRef, !disabled && onPress ? [activate.hint] : []);
  const mousePressedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);

  const setButtonRef = useCallback(
    (node: BoxRenderable | null) => {
      buttonRef.current = node;
      assignRef(ref, node);

      if (!node) {
        return;
      }

      setIsFocused(node.focused);

      const handleFocus = () => setIsFocused(true);
      const handleBlur = () => setIsFocused(false);

      node.on(RenderableEvents.FOCUSED, handleFocus);
      node.on(RenderableEvents.BLURRED, handleBlur);

      return () => {
        node.off(RenderableEvents.FOCUSED, handleFocus);
        node.off(RenderableEvents.BLURRED, handleBlur);

        if (buttonRef.current === node) {
          buttonRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  // OpenTUI currently doesn't automatically blur a focused renderable when
  // focusable becomes false, and blur() itself requires focusable=true.
  useLayoutEffect(() => {
    if (!disabled) {
      return;
    }

    mousePressedRef.current = false;

    const button = buttonRef.current;

    if (!button?.focused) {
      return;
    }

    button.focusable = true;
    button.blur();
    button.focusable = false;
  }, [disabled]);

  const baseVisual = buttonVariants[variant];

  const visual: ButtonVisual = disabled
    ? {
        bg: variant === "ghost" ? undefined : "muted",
        fg: "mutedForeground",
      }
    : isFocused
      ? {
          bg: "focus",
          fg:
            variant === "primary"
              ? "primary"
              : variant === "destructive"
                ? "error"
                : "focusForeground",
        }
      : {
          bg: bg ?? baseVisual.bg,
          fg: fg ?? baseVisual.fg,
        };

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled || event.repeated || !onPress) {
      return;
    }

    if (!activate.names.includes(event.name)) {
      return;
    }

    event.preventDefault();
    onPress();
  }

  function handleMouseDown(this: BoxRenderable, event: OpenTUIMouseEvent) {
    onMouseDown?.call(this, event);

    if (event.defaultPrevented || disabled || !onPress || event.button !== MouseButton.LEFT) {
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
      !onPress ||
      !wasPressed ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }

    onPress();
  }

  function handleMouseOut(this: BoxRenderable, event: OpenTUIMouseEvent) {
    mousePressedRef.current = false;
    onMouseOut?.call(this, event);
  }

  return (
    <Box
      {...props}
      ref={setButtonRef}
      focusable={!disabled}
      focused={disabled ? false : focused}
      bg={visual.bg}
      flexDirection={flexDirection}
      alignItems={alignItems}
      justifyContent={justifyContent}
      paddingX={paddingX}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Text fg={visual.fg}>{children}</Text>
    </Box>
  );
}
