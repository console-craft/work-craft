import { type BoxRenderable, type KeyEvent, parseColor } from "@opentui/core";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { Ref } from "react";

import { Box, type BoxProps } from "@/ui/primitives/box";
import { resolveColor, type ThemeColor } from "@/ui/theming/theme";
import { useTheme } from "@/ui/theming/theme-provider";
import { assignRef, setDisabled } from "@/ui/utils";

type Orientation = "horizontal" | "vertical";

type SliderMouseEvent = Parameters<NonNullable<BoxProps["onMouseDown"]>>[0];

type SliderColorProps = {
  trackColor?: ThemeColor;
  fillColor?: ThemeColor;
  thumbColor?: ThemeColor;

  focusedBackgroundColor?: ThemeColor;
  focusedForegroundColor?: ThemeColor;

  disabledColor?: ThemeColor;
};

export interface SliderProps
  extends
    Omit<
      BoxProps,
      | "children"
      | "ref"
      | "focusable"
      | "onKeyDown"
      | "onMouseDown"
      | "onMouseDrag"
      | "onMouseUp"
      | "renderAfter"
    >,
    SliderColorProps {
  ref?: Ref<BoxRenderable>;

  value?: number;
  min?: number;
  max?: number;
  step?: number;

  orientation?: Orientation;
  disabled?: boolean;

  onValueChange?: (value: number) => void;

  onKeyDown?: BoxProps["onKeyDown"];
  onMouseDown?: BoxProps["onMouseDown"];
  onMouseDrag?: BoxProps["onMouseDrag"];
  onMouseUp?: BoxProps["onMouseUp"];
  renderAfter?: BoxProps["renderAfter"];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanNumber(value: number) {
  return Number(value.toPrecision(15));
}

function snapToStep(value: number, min: number, max: number, step: number) {
  if (value <= min) return min;
  if (value >= max) return max;

  const steps = Math.round((value - min) / step);

  return clamp(cleanNumber(min + steps * step), min, max);
}

export function Slider({
  ref,

  value,
  min = 0,
  max = 100,
  step = 1,

  orientation = "horizontal",
  disabled = false,

  trackColor = "secondary",
  fillColor = "primary",
  thumbColor = "primary",

  focusedBackgroundColor = "focus",
  focusedForegroundColor = "focusForeground",

  disabledColor = "mutedForeground",

  width,
  height,

  onValueChange,
  onKeyDown,
  onMouseDown,
  onMouseDrag,
  onMouseUp,
  renderAfter,

  ...props
}: SliderProps) {
  if (!Number.isFinite(min)) {
    throw new Error("<Slider> min must be finite");
  }

  if (!Number.isFinite(max)) {
    throw new Error("<Slider> max must be finite");
  }

  if (min > max) {
    throw new Error("<Slider> min cannot be greater than max");
  }

  if (!Number.isFinite(step) || step <= 0) {
    throw new Error("<Slider> step must be a positive finite number");
  }

  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error("<Slider> value must be finite");
  }

  const theme = useTheme();

  const sliderRef = useRef<BoxRenderable | null>(null);
  const mousePressedRef = useRef(false);

  const currentValue = clamp(value ?? min, min, max);

  const resolvedWidth = width ?? (orientation === "horizontal" ? 20 : 1);

  const resolvedHeight = height ?? (orientation === "horizontal" ? 1 : 10);

  const normalTrackColor = parseColor(resolveColor(theme, trackColor));

  const normalFillColor = parseColor(resolveColor(theme, fillColor));

  const normalThumbColor = parseColor(resolveColor(theme, thumbColor));

  const focusBackgroundColor = parseColor(resolveColor(theme, focusedBackgroundColor));

  const focusForegroundColor = parseColor(resolveColor(theme, focusedForegroundColor));

  const resolvedDisabledColor = parseColor(resolveColor(theme, disabledColor));

  const setSliderRef = useCallback(
    (node: BoxRenderable | null) => {
      sliderRef.current = node;
      assignRef(ref, node);

      return () => {
        if (sliderRef.current === node) {
          sliderRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    mousePressedRef.current = false;
    setDisabled(sliderRef.current, disabled);
  }, [disabled]);

  function emitValue(nextValue: number) {
    if (Object.is(nextValue, currentValue)) {
      return;
    }

    onValueChange?.(nextValue);
  }

  function changeByStep(direction: -1 | 1) {
    const nextValue = clamp(cleanNumber(currentValue + direction * step), min, max);

    emitValue(nextValue);
  }

  function updateFromMouse(event: SliderMouseEvent) {
    const slider = sliderRef.current;

    if (!slider || max === min) {
      return;
    }

    let ratio: number;

    if (orientation === "horizontal") {
      const trackLength = Math.max(1, slider.width - 1);
      const localX = clamp(event.x - slider.x, 0, trackLength);

      ratio = localX / trackLength;
    } else {
      const trackLength = Math.max(1, slider.height - 1);
      const localY = clamp(event.y - slider.y, 0, trackLength);

      // Vertical sliders increase upward.
      ratio = 1 - localY / trackLength;
    }

    const rawValue = min + ratio * (max - min);

    emitValue(snapToStep(rawValue, min, max, step));
  }

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    if (event.ctrl || event.meta || event.super || event.shift) {
      return;
    }

    const name = event.name.toLowerCase();

    if (name === "home") {
      event.preventDefault();
      emitValue(min);
      return;
    }

    if (name === "end") {
      event.preventDefault();
      emitValue(max);
      return;
    }

    if (orientation === "horizontal") {
      if (name === "left" || name === "h") {
        event.preventDefault();
        changeByStep(-1);
        return;
      }

      if (name === "right" || name === "l") {
        event.preventDefault();
        changeByStep(1);
      }

      return;
    }

    if (name === "down" || name === "j") {
      event.preventDefault();
      changeByStep(-1);
      return;
    }

    if (name === "up" || name === "k") {
      event.preventDefault();
      changeByStep(1);
    }
  }

  function handleMouseDown(event: SliderMouseEvent) {
    const slider = sliderRef.current;

    if (slider) {
      onMouseDown?.call(slider, event);
    }

    if (event.defaultPrevented || disabled || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    mousePressedRef.current = true;
    slider?.focus();

    updateFromMouse(event);
  }

  function handleMouseDrag(event: SliderMouseEvent) {
    const slider = sliderRef.current;

    if (slider) {
      onMouseDrag?.call(slider, event);
    }

    if (event.defaultPrevented || disabled || !mousePressedRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    updateFromMouse(event);
  }

  function handleMouseUp(event: SliderMouseEvent) {
    const slider = sliderRef.current;

    if (slider) {
      onMouseUp?.call(slider, event);
    }

    if (disabled || !mousePressedRef.current) {
      return;
    }

    mousePressedRef.current = false;

    if (event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    updateFromMouse(event);
  }

  const handleRenderAfter = useCallback<NonNullable<BoxProps["renderAfter"]>>(
    function (buffer, deltaTime) {
      const slider = sliderRef.current;

      if (!slider) {
        return;
      }

      const focused = slider.focused && !disabled;

      let currentTrackColor = normalTrackColor;
      let currentFillColor = normalFillColor;
      let currentThumbColor = normalThumbColor;
      let backgroundColor = slider.backgroundColor;

      if (disabled) {
        currentTrackColor = resolvedDisabledColor;
        currentFillColor = resolvedDisabledColor;
        currentThumbColor = resolvedDisabledColor;
      } else if (focused) {
        currentTrackColor = focusForegroundColor;
        currentFillColor = focusForegroundColor;
        currentThumbColor = focusForegroundColor;
        backgroundColor = focusBackgroundColor;

        buffer.fillRect(slider.x, slider.y, slider.width, slider.height, focusBackgroundColor);
      }

      const range = max - min;

      const ratio = range === 0 ? 0 : (currentValue - min) / range;

      if (orientation === "horizontal") {
        const length = slider.width;

        if (length > 0) {
          const thumbIndex = length === 1 ? 0 : Math.round(ratio * (length - 1));

          const y = slider.y + Math.floor((slider.height - 1) / 2);

          for (let index = 0; index < length; index++) {
            const isThumb = index === thumbIndex;
            const isFilled = index < thumbIndex;

            const character = isThumb ? "●" : isFilled ? "━" : "─";

            const foregroundColor = isThumb
              ? currentThumbColor
              : isFilled
                ? currentFillColor
                : currentTrackColor;

            buffer.setCellWithAlphaBlending(
              slider.x + index,
              y,
              character,
              foregroundColor,
              backgroundColor,
            );
          }
        }
      } else {
        const length = slider.height;

        if (length > 0) {
          const thumbIndex = length === 1 ? 0 : Math.round((1 - ratio) * (length - 1));

          const x = slider.x + Math.floor((slider.width - 1) / 2);

          for (let index = 0; index < length; index++) {
            const isThumb = index === thumbIndex;

            // The filled portion grows upward from min.
            const isFilled = index > thumbIndex;

            const character = isThumb ? "●" : isFilled ? "┃" : "│";

            const foregroundColor = isThumb
              ? currentThumbColor
              : isFilled
                ? currentFillColor
                : currentTrackColor;

            buffer.setCellWithAlphaBlending(
              x,
              slider.y + index,
              character,
              foregroundColor,
              backgroundColor,
            );
          }
        }
      }

      renderAfter?.call(slider, buffer, deltaTime);
    },
    [
      currentValue,
      disabled,
      focusBackgroundColor,
      focusForegroundColor,
      max,
      min,
      normalFillColor,
      normalThumbColor,
      normalTrackColor,
      orientation,
      renderAfter,
      resolvedDisabledColor,
    ],
  );

  return (
    <Box
      {...props}
      ref={setSliderRef}
      focusable
      width={resolvedWidth}
      height={resolvedHeight}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseDrag={handleMouseDrag}
      onMouseUp={handleMouseUp}
      renderAfter={handleRenderAfter}
    />
  );
}
