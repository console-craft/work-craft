import {
  BoxRenderable,
  type KeyEvent,
  type Renderable,
  type TextareaRenderable,
} from "@opentui/core";
import { Edge, PositionType, Unit } from "@opentui/core/yoga";
import { Children, type ReactNode, type Ref } from "react";

function horizontalBorderWidth(node: Renderable): number {
  const border = node instanceof BoxRenderable ? node.border : false;
  return Array.isArray(border)
    ? Number(border.includes("left")) + Number(border.includes("right"))
    : border
      ? 2
      : 0;
}

/** Resolve requested Yoga padding when allocating columns inside the laid-out content area. */
export function getContentWidth(node: Renderable): number {
  let padding = 0;
  let referenceWidth: number | undefined;
  for (const edge of [Edge.Left, Edge.Right]) {
    const value = [edge, Edge.Horizontal, Edge.All]
      .map((candidate) => node.getPadding(candidate))
      .find((value) => Number.isFinite(value.value));
    if (value) {
      if (value.unit === Unit.Percent) {
        if (referenceWidth === undefined) {
          const parent = node.parent;
          if (node.getPositionType() === PositionType.Absolute) {
            // Absolute percentages use the containing block's padding box, not its content box.
            referenceWidth = parent ? parent.getLayout().width - horizontalBorderWidth(parent) : 0;
          } else {
            referenceWidth = parent ? getContentWidth(parent) : 0;
          }
        }
        padding += (value.value * referenceWidth) / 100;
      } else {
        padding += value.value;
      }
    }
  }
  return Math.max(0, node.getLayout().width - padding - horizontalBorderWidth(node));
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
