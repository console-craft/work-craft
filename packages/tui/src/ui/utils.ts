import type { Renderable } from "@opentui/core";
import type { Ref } from "react";

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
