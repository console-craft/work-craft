import {
  CliRenderEvents,
  type KeyEvent,
  type MouseEvent,
  Renderable,
  ScrollBoxRenderable,
} from "@opentui/core";
import {
  type ScrollBoxProps as OpenTUIScrollBoxProps,
  useKeyboard,
  useRenderer,
} from "@opentui/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useControlHints } from "@/ui/control-hints";
import { isEligibleFocusTarget } from "@/ui/focus-utils";
import { pointerPosition, recordPointerPosition, usePointerObservation } from "@/ui/pointer";
import { resolveColor, type ThemeColor } from "@/ui/theme";
import { useTheme } from "@/ui/theme-provider";
import { assignRef } from "@/ui/utils";

function nearestScrollBox(node: Renderable | null): ScrollBoxRenderable | null {
  for (let current = node; current; current = current.parent) {
    if (current instanceof ScrollBoxRenderable) {
      return current;
    }
  }
  return null;
}

function isScrollKey(key: KeyEvent): boolean {
  if (key.meta || key.option || key.super || key.hyper) {
    return false;
  }
  if (key.ctrl) {
    return !key.shift && ["d", "u"].includes(key.name);
  }
  return (
    key.name === "g" ||
    (!key.shift &&
      [
        "up",
        "down",
        "left",
        "right",
        "h",
        "j",
        "k",
        "l",
        "home",
        "end",
        "pageup",
        "pagedown",
      ].includes(key.name))
  );
}

type ThemedColorProps = {
  bg?: ThemeColor;
  borderColor?: ThemeColor;
  focusedBorderColor?: ThemeColor;
  titleColor?: ThemeColor;

  /** Overrides the automatic primary/mutedForeground activity color. */
  scrollbarColor?: ThemeColor;
  scrollbarTrackColor?: ThemeColor;
};

export interface ScrollAreaProps
  extends
    Omit<OpenTUIScrollBoxProps, "backgroundColor" | keyof ThemedColorProps>,
    ThemedColorProps {
  /** Let unhandled descendant keys fall back to this viewport after native control dispatch. */
  keyboardFallback?: boolean;
}

/** Reveals newly focused descendants; keyboardFallback adds control-first ancestor scrolling. */
export function ScrollArea({
  children,
  ref,
  bg,
  border,
  borderStyle,
  borderColor,
  focusedBorderColor,
  titleColor,
  scrollbarColor,
  scrollbarTrackColor = "muted",
  scrollbarOptions,
  verticalScrollbarOptions,
  horizontalScrollbarOptions,
  contentOptions,
  scrollX = false,
  scrollY = true,
  onKeyDown,
  onMouse,
  onMouseScroll,
  keyboardFallback = false,
  ...props
}: ScrollAreaProps) {
  const theme = useTheme();
  const renderer = useRenderer();
  const scrollAreaRef = useRef<ScrollBoxRenderable | null>(null);
  const [focused, setFocused] = useState<Renderable | null>(null);
  const [active, setActive] = useState(false);
  const keyboardResult = useRef<{ target: Renderable; active: boolean } | null>(null);

  usePointerObservation();

  useLayoutEffect(() => {
    function updateActivity() {
      const area = scrollAreaRef.current;
      if (!area) {
        return;
      }
      const target = renderer.currentFocusedRenderable;
      const keyboardOwner =
        target &&
        isEligibleFocusTarget(target, area) &&
        (target === area || (keyboardFallback && nearestScrollBox(target.parent) === area));
      // ponytail: native handlers initially own navigation; declared bindings would make first-key prediction exact.
      const keyboardActive =
        keyboardOwner &&
        (keyboardResult.current?.target === target
          ? keyboardResult.current.active
          : target === area || !target.handleKeyPress);
      const pointer = pointerPosition(renderer);
      const hovered = pointer
        ? (Renderable.renderablesByNumber.get(renderer.hitTest(pointer.x, pointer.y)) ?? target)
        : null;
      const wheelActive = renderer.useMouse && nearestScrollBox(hovered) === area;
      const overflowing =
        (scrollY && area.scrollHeight > area.viewport.height) ||
        (scrollX && area.scrollWidth > area.viewport.width);
      setActive(Boolean(overflowing && (keyboardActive || wheelActive)));
    }
    function resetKeyboard() {
      keyboardResult.current = null;
      setFocused(renderer.currentFocusedRenderable);
      updateActivity();
    }
    renderer.on(CliRenderEvents.FRAME, updateActivity);
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, resetKeyboard);
    resetKeyboard();
    return () => {
      renderer.off(CliRenderEvents.FRAME, updateActivity);
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, resetKeyboard);
    };
  }, [renderer, keyboardFallback, scrollX, scrollY]);

  useKeyboard((key) => {
    const area = scrollAreaRef.current;
    const target = renderer.currentFocusedRenderable;
    if (!keyboardFallback || !area || !target || !isEligibleFocusTarget(target, area.content)) {
      return;
    }
    if (nearestScrollBox(target.parent) !== area) {
      return;
    }
    // Global hooks run before native controls. Defer fallback so their consumption wins.
    queueMicrotask(() => {
      if (
        !area.isDestroyed &&
        scrollAreaRef.current === area &&
        renderer.currentFocusedRenderable === target &&
        isEligibleFocusTarget(target, area.content)
      ) {
        handleKeyDown(key);
      }
    });
  });
  useControlHints(
    scrollAreaRef,
    scrollY
      ? [
          { keys: "Ctrl+d/u", label: "Half-page" },
          { keys: "g/G", label: "Top/bottom" },
        ]
      : [],
  );

  const handleRef = useCallback(
    (renderable: ScrollBoxRenderable | null) => {
      scrollAreaRef.current = renderable;
      assignRef(ref, renderable);
      return () => {
        if (scrollAreaRef.current === renderable) {
          scrollAreaRef.current = null;
        }
        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    const area = scrollAreaRef.current;
    if (!area || !focused || !isEligibleFocusTarget(focused, area.content)) {
      return;
    }
    const reveal = () => {
      renderer.off(CliRenderEvents.FRAME, reveal);
      if (
        renderer.currentFocusedRenderable === focused &&
        isEligibleFocusTarget(focused, area.content)
      ) {
        area.scrollChildIntoView(focused.id);
      }
    };
    renderer.on(CliRenderEvents.FRAME, reveal);
    area.requestRender();
    return () => {
      renderer.off(CliRenderEvents.FRAME, reveal);
    };
  }, [focused, renderer]);

  function handleKeyDown(key: KeyEvent) {
    const target = renderer.currentFocusedRenderable;
    const scrolling = isScrollKey(key);
    if (target && scrolling) {
      keyboardResult.current = { target, active: false };
      renderer.requestRender();
    }
    onKeyDown?.(key);
    const area = scrollAreaRef.current;
    if (
      !area ||
      (!scrollX && !scrollY) ||
      key.defaultPrevented ||
      key.propagationStopped ||
      key.meta ||
      key.option ||
      key.super ||
      key.hyper
    ) {
      return;
    }
    if (scrollY && key.ctrl && !key.shift && ["d", "u"].includes(key.name)) {
      area.scrollBy(key.name === "d" ? 0.5 : -0.5, "viewport");
    } else if (scrollY && !key.ctrl && key.name === "g") {
      area.scrollTo({ x: area.scrollLeft, y: key.shift ? area.scrollHeight : 0 });
    } else if (!key.ctrl && !key.shift && area.handleKeyPress(key)) {
      // Native arrows, h/j/k/l, PageUp/PageDown, Home and End already implement scrolling.
    } else {
      return;
    }
    key.preventDefault();
    key.stopPropagation();
    if (target && scrolling) {
      keyboardResult.current = { target, active: true };
    }
  }

  function handleMouse(this: ScrollBoxRenderable, event: MouseEvent) {
    recordPointerPosition(renderer, { x: event.x, y: event.y });
    renderer.requestRender();
    onMouse?.call(this, event);
  }

  function handleMouseScroll(this: ScrollBoxRenderable, event: MouseEvent) {
    onMouseScroll?.call(this, event);
    // Native scrolling still runs on this viewport after the callback; ancestors must not scroll too.
    event.stopPropagation();
  }

  const hasBorder =
    Boolean(border) ||
    borderStyle !== undefined ||
    borderColor !== undefined ||
    focusedBorderColor !== undefined ||
    props.customBorderChars !== undefined;
  const themedScrollbarOptions = {
    ...scrollbarOptions,
    trackOptions: {
      foregroundColor: resolveColor(
        theme,
        scrollbarColor ?? (active ? "primary" : "mutedForeground"),
      ),
      backgroundColor: resolveColor(theme, scrollbarTrackColor),
      ...scrollbarOptions?.trackOptions,
    },
  };

  return (
    <scrollbox
      {...props}
      ref={handleRef}
      scrollX={scrollX}
      scrollY={scrollY}
      contentOptions={{
        // OpenTUI 0.5.14 keeps 100% height after the horizontal bar consumes a row.
        ...(scrollX && scrollY ? { minHeight: 0 } : {}),
        ...contentOptions,
      }}
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
      scrollbarOptions={themedScrollbarOptions}
      verticalScrollbarOptions={{
        ...themedScrollbarOptions,
        ...verticalScrollbarOptions,
        trackOptions: {
          ...themedScrollbarOptions.trackOptions,
          ...verticalScrollbarOptions?.trackOptions,
        },
      }}
      horizontalScrollbarOptions={{
        ...themedScrollbarOptions,
        ...horizontalScrollbarOptions,
        trackOptions: {
          ...themedScrollbarOptions.trackOptions,
          ...horizontalScrollbarOptions?.trackOptions,
        },
      }}
      onKeyDown={handleKeyDown}
      onMouse={handleMouse}
      onMouseScroll={handleMouseScroll}
    >
      {children}
    </scrollbox>
  );
}
