import type { BoxRenderable } from "@opentui/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { isVisible } from "@/ui/focus-utils";

export type ListItemRecord = { id: string; value: string; disabled: boolean; node: BoxRenderable };
type ListCursorOptions = {
  value?: string;
  defaultValue?: string;
  activeValue?: string;
  defaultActiveValue?: string;
  controlledValue: boolean;
  controlledActive: boolean;
  disabled: boolean;
  onValueChange?(value: string): void;
  onActiveValueChange?(value: string | undefined): void;
  onActivate?(value: string): void;
  getItems(): readonly ListItemRecord[];
  root(): BoxRenderable | null;
};
type ListCursorController = {
  value: string | undefined;
  activeValue: string | undefined;
  /** Native batches read the cursor before React commits its highlight. */
  getActive(): string | undefined;
  canNavigate(): boolean;
  changeActive(next: string | undefined, repair?: boolean): void;
  repair(): void;
  activate(value: string): void;
};

export function useListCursor({
  value,
  defaultValue,
  activeValue,
  defaultActiveValue,
  controlledValue,
  controlledActive,
  disabled,
  onValueChange,
  onActiveValueChange,
  onActivate,
  getItems,
  root,
}: ListCursorOptions): ListCursorController {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalActive, setInternalActive] = useState(defaultActiveValue);
  const currentValue = controlledValue ? value : internalValue;
  const currentActive = controlledActive ? activeValue : internalActive;
  const state = useRef({
    value: currentValue,
    active: currentActive,
    controlledValue,
    controlledActive,
    onValueChange,
    onActiveValueChange,
    onActivate,
    disabled,
  });
  state.current = {
    value: currentValue,
    active: currentActive,
    controlledValue,
    controlledActive,
    onValueChange,
    onActiveValueChange,
    onActivate,
    disabled,
  };
  const repairRequest = useRef<{ from: string | undefined; to: string | undefined } | null>(null);
  useLayoutEffect(() => {
    if (disabled) {
      repairRequest.current = null;
    }
  }, [disabled]);

  const changeActive = useCallback((next: string | undefined, repair = false) => {
    const current = state.current;
    if (current.disabled) {
      return;
    }
    if (next === current.active) {
      repairRequest.current = null;
      return;
    }
    if (current.controlledActive) {
      if (!current.onActiveValueChange) {
        repairRequest.current = null;
        return;
      }
      const pending = repairRequest.current;
      if (repair && pending && pending.from === current.active && pending.to === next) {
        return;
      }
      repairRequest.current = repair ? { from: current.active, to: next } : null;
    } else {
      current.active = next;
      setInternalActive(next);
    }
    current.onActiveValueChange?.(next);
  }, []);

  const repair = useCallback(() => {
    const node = root();
    if (
      state.current.disabled ||
      !node ||
      !isVisible(node) ||
      (state.current.active === undefined && !node.focused)
    ) {
      return;
    }
    const eligible = getItems();
    if (eligible.some((item) => item.value === state.current.active)) {
      repairRequest.current = null;
      return;
    }
    const selected = eligible.find((item) => item.value === state.current.value);
    changeActive(selected?.value ?? eligible[0]?.value, true);
  }, [getItems, changeActive]);

  const activate = useCallback(
    (value: string) => {
      const target = getItems().find((item) => item.value === value);
      if (!target) {
        return;
      }
      changeActive(value);
      if (!getItems().includes(target)) {
        return;
      }
      const current = state.current;
      if (current.value !== value) {
        if (!current.controlledValue) {
          current.value = value;
          setInternalValue(value);
        }
        current.onValueChange?.(value);
      }
      if (getItems().includes(target)) {
        state.current.onActivate?.(value);
      }
    },
    [getItems, changeActive],
  );

  return {
    value: currentValue,
    activeValue: currentActive,
    changeActive,
    repair,
    activate,
    getActive: () => state.current.active,
    canNavigate: () =>
      !state.current.controlledActive || state.current.onActiveValueChange !== undefined,
  };
}
