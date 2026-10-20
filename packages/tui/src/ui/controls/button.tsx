import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent as OpenTUIMouseEvent,
} from "@opentui/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { type ControlHintSource, useControlHints } from "@/ui/interaction/control-hints";
import { observeControlFocus } from "@/ui/interaction/focus-utils";
import { Box, type BoxProps } from "@/ui/primitives/box";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theming/theme";
import { assignRef, isTextContent, setDisabled } from "@/ui/utils";

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
  /** Composite controls can replace activation hints, including with a live getter. */
  controlHints?: ControlHintSource;
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
  controlHints,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseOut,

  ...props
}: ButtonProps) {
  const buttonRef = useRef<BoxRenderable | null>(null);
  useControlHints(buttonRef, disabled ? [] : (controlHints ?? (onPress ? [activate.hint] : [])));
  const mousePressedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);

  const setButtonRef = useCallback(
    (node: BoxRenderable | null) => {
      buttonRef.current = node;
      assignRef(ref, node);

      if (!node) {
        return;
      }

      const releaseFocus = observeControlFocus(node, setIsFocused);

      return () => {
        releaseFocus();

        if (buttonRef.current === node) {
          buttonRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (!disabled) {
      return;
    }

    mousePressedRef.current = false;

    const button = buttonRef.current;

    if (!button?.focused) {
      return;
    }

    setDisabled(button, true);
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
      {isTextContent(children) ? <Text fg={visual.fg}>{children}</Text> : children}
    </Box>
  );
}
