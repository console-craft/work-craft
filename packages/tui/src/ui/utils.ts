import {
  BoxRenderable,
  type KeyEvent,
  type Renderable,
  type TextareaRenderable,
} from "@opentui/core";
import { Edge, Unit } from "@opentui/core/yoga";
import { Children, type ReactNode, type Ref } from "react";

/** OpenTUI exposes requested padding; Yoga resolves percentages against the parent's content width. */
export function getContentWidth(node: Renderable): number {
  let padding = 0;
  for (const edge of [Edge.Left, Edge.Right]) {
    const value = [edge, Edge.Horizontal, Edge.All]
      .map((candidate) => node.getPadding(candidate))
      .find((value) => Number.isFinite(value.value));
    if (value) {
      padding +=
        value.unit === Unit.Percent
          ? (value.value * (node.parent ? getContentWidth(node.parent) : 0)) / 100
          : value.value;
    }
  }
  const border = node instanceof BoxRenderable ? node.border : false;
  const borderWidth = Array.isArray(border)
    ? Number(border.includes("left")) + Number(border.includes("right"))
    : border
      ? 2
      : 0;
  return Math.max(0, node.getLayout().width - padding - borderWidth);
}

// Focus

export function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export function setDisabled(renderable: Renderable | null, disabled: boolean) {
  if (!renderable) {
    return;
  }

  if (disabled && renderable.focused) {
    renderable.focusable = true;
    renderable.blur();
  }

  renderable.focusable = !disabled;
}

/** Native handlers report consumption as a return value rather than preventing the key event. */
export function consumeNativeKey(renderable: Renderable | null, event: KeyEvent): void {
  if (event.defaultPrevented || event.propagationStopped) {
    return;
  }
  if (renderable?.handleKeyPress?.(event)) {
    event.preventDefault();
  }
}

/** Nonempty focused editors own Ctrl+C; empty editors leave it available to callers. */
export function clearTextOnCtrlC(renderable: TextareaRenderable | null, event: KeyEvent): boolean {
  if (
    event.defaultPrevented ||
    event.propagationStopped ||
    event.name !== "c" ||
    !event.ctrl ||
    event.shift ||
    event.meta ||
    event.option ||
    event.super ||
    event.hyper ||
    !renderable?.focused ||
    renderable.plainText.length === 0
  ) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  // Programmatic selection works even when interactive selection is disabled.
  renderable.clearSelection();
  renderable.gotoBufferEnd();
  renderable.setSelection(0, renderable.cursorOffset);
  renderable.deleteCharBackward();
  return true;
}

// Text

export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

export function textTransform(text: string, transformation: TextTransform) {
  switch (transformation) {
    case "uppercase":
      return text.toUpperCase();

    case "lowercase":
      return text.toLowerCase();

    case "capitalize":
      return text.charAt(0).toUpperCase() + text.slice(1);

    case "none":
    default:
      return text;
  }
}

export function isTextContent(node: ReactNode): boolean {
  return Children.toArray(node).every(
    (child) => typeof child === "string" || typeof child === "number",
  );
}
