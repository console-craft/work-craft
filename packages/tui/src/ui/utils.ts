import type { KeyEvent, Renderable } from "@opentui/core";
import type { ReactNode, Ref } from "react";

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

export function isTextContent(node: ReactNode) {
  return typeof node === "string" || typeof node === "number";
}
