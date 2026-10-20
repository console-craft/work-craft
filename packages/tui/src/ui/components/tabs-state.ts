import { type BoxRenderable, CliRenderEvents, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { TabsProps } from "@/ui/components/tabs";
import { cyclicIndex, renderedOrder } from "@/ui/interaction/collection";
import {
  focusRenderable,
  getFocusableRenderables,
  isEligibleFocusTarget,
} from "@/ui/interaction/focus-utils";

interface TabsTriggerRecord {
  disabled: boolean;
  node: BoxRenderable;
}

export interface TabsContextValue {
  value: string | undefined;
  canChange: boolean;

  select: (value: string) => void;
  activate: (value?: string) => boolean;
  cancelActivation: () => void;
  resetNavigation: (value?: string) => void;
  revealId: string | undefined;
  setContent: (value: string, content: BoxRenderable | null) => void;

  registerTrigger: (value: string, disabled: boolean, node: BoxRenderable) => () => void;

  setTriggerDisabled: (value: string, disabled: boolean) => void;

  selectNext: () => void;
  selectPrevious: () => void;
  selectFirst: () => void;
  selectLast: () => void;
}

function hasFocusableTarget(node: Renderable): boolean {
  return (
    !node.isDestroyed &&
    node.visible &&
    (node.focusable || node.getChildren().some(hasFocusableTarget))
  );
}

export function useTabsState({
  value,
  defaultValue,
  onValueChange,
  onActivate,
  controlled,
}: Pick<TabsProps, "value" | "defaultValue" | "onValueChange" | "onActivate"> & {
  controlled: boolean;
}): TabsContextValue {
  const renderer = useRenderer();
  const [internalValue, setInternalValue] = useState<string | undefined>(defaultValue);

  const currentValue = controlled ? value : internalValue;
  const canChange = !controlled || onValueChange !== undefined;

  const triggers = useRef(new Map<string, TabsTriggerRecord>());
  const contents = useRef(new Map<string, BoxRenderable>());
  const pendingActivation = useRef<{
    value: string;
    previousValue: string | undefined;
    source: Renderable;
    content: BoxRenderable;
  } | null>(null);
  const navigationRef = useRef(currentValue);
  const navigationRequests = useRef<string[]>([]);
  const [candidate, setCandidate] = useState(currentValue);
  const [triggerVersion, setTriggerVersion] = useState(0);

  const controlledRef = useRef(controlled);
  const currentValueRef = useRef(currentValue);
  const onValueChangeRef = useRef(onValueChange);
  const onActivateRef = useRef(onActivate);

  controlledRef.current = controlled;
  if (currentValueRef.current !== currentValue) {
    currentValueRef.current = currentValue;
    const committed =
      currentValue === undefined ? -1 : navigationRequests.current.indexOf(currentValue);
    if (committed === -1) {
      navigationRequests.current = [];
    } else {
      navigationRequests.current.splice(0, committed + 1);
      if (pendingActivation.current) {
        pendingActivation.current.previousValue = currentValue;
      }
    }
    if (navigationRequests.current.length === 0) {
      navigationRef.current = currentValue;
    }
  }
  onValueChangeRef.current = onValueChange;
  onActivateRef.current = onActivate;

  const cancelActivation = useCallback(() => {
    pendingActivation.current = null;
  }, []);

  useLayoutEffect(() => {
    // Native events catch leave-and-return even when React sees only the final focus.
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, cancelActivation);
    return () => {
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, cancelActivation);
    };
  }, [renderer, cancelActivation]);

  const resetNavigation = useCallback((value?: string) => {
    const next =
      value !== undefined && triggers.current.get(value)?.disabled === false
        ? value
        : currentValueRef.current;
    navigationRequests.current = [];
    navigationRef.current = next;
    setCandidate(next);
  }, []);

  useLayoutEffect(() => {
    setCandidate(navigationRef.current);
  }, [currentValue]);

  const setContent = useCallback((value: string, content: BoxRenderable | null) => {
    if (content) {
      contents.current.set(value, content);
    } else {
      contents.current.delete(value);
      if (pendingActivation.current?.value === value) {
        pendingActivation.current = null;
      }
    }
  }, []);

  const activate = useCallback(
    (value = navigationRef.current): boolean => {
      pendingActivation.current = null;
      if (value === undefined || triggers.current.get(value)?.disabled !== false) {
        return false;
      }
      if (onActivateRef.current) {
        onActivateRef.current(value);
        return true;
      }
      const content = contents.current.get(value);
      if (!content || content.isDestroyed) {
        return false;
      }
      // Buffered switching can select a panel before React commits its visibility.
      if (currentValueRef.current !== value || !content.visible) {
        const source = renderer.currentFocusedRenderable;
        if (!source || !isEligibleFocusTarget(source, renderer.root)) {
          return false;
        }
        if (!content.focusable && !content.getChildren().some(hasFocusableTarget)) {
          return false;
        }
        pendingActivation.current = {
          value,
          previousValue: currentValueRef.current,
          source,
          content,
        };
        return true;
      }
      const target = getFocusableRenderables(content)[0] ?? content;
      return isEligibleFocusTarget(target, content) && focusRenderable(renderer, target) !== null;
    },
    [renderer],
  );

  useLayoutEffect(() => {
    const requested = pendingActivation.current;
    if (!requested) {
      return;
    }
    if (
      requested.source !== renderer.currentFocusedRenderable ||
      !isEligibleFocusTarget(requested.source, renderer.root) ||
      contents.current.get(requested.value) !== requested.content ||
      triggers.current.get(requested.value)?.disabled !== false ||
      (currentValue !== requested.previousValue && currentValue !== requested.value)
    ) {
      pendingActivation.current = null;
    } else if (requested.value === currentValue && requested.content.visible) {
      activate(requested.value);
    }
  });

  const getEnabledValues = useCallback(() => {
    const byNode = new Map(
      [...triggers.current].map(([value, trigger]) => [trigger.node, { value, ...trigger }]),
    );
    return renderedOrder(renderer.root, byNode)
      .filter((trigger) => !trigger.disabled)
      .map((trigger) => trigger.value);
  }, [renderer]);

  const setInitialValue = useCallback((value: string | undefined) => {
    if (controlledRef.current) {
      return;
    }

    pendingActivation.current = null;
    currentValueRef.current = value;
    navigationRef.current = value;
    setCandidate(value);
    setInternalValue(value);
  }, []);

  const select = useCallback((value: string) => {
    const trigger = triggers.current.get(value);

    if (!trigger || trigger.disabled) {
      return;
    }

    pendingActivation.current = null;
    if (navigationRef.current === value) {
      return;
    }
    navigationRef.current = value;
    setCandidate(value);
    if (!controlledRef.current) {
      currentValueRef.current = value;
      setInternalValue(value);
    } else {
      navigationRequests.current.push(value);
    }

    onValueChangeRef.current?.(value);
  }, []);

  const registerTrigger = useCallback(
    (value: string, disabled: boolean, node: BoxRenderable) => {
      triggers.current.set(value, { disabled, node });
      setTriggerVersion((version) => version + 1);

      if (!controlledRef.current && currentValueRef.current === undefined && !disabled) {
        setInitialValue(value);
      }

      return () => {
        const selected = currentValueRef.current === value;

        triggers.current.delete(value);
        if (pendingActivation.current?.value === value) {
          pendingActivation.current = null;
        }
        setTriggerVersion((version) => version + 1);

        if (!controlledRef.current && selected) {
          setInitialValue(getEnabledValues()[0]);
        }
      };
    },
    [getEnabledValues, setInitialValue],
  );

  const setTriggerDisabled = useCallback(
    (value: string, disabled: boolean) => {
      const trigger = triggers.current.get(value);

      if (!trigger) {
        return;
      }

      trigger.disabled = disabled;

      if (controlledRef.current) {
        return;
      }

      if (disabled && currentValueRef.current === value) {
        setInitialValue(getEnabledValues()[0]);
      } else if (currentValueRef.current === undefined && !disabled) {
        setInitialValue(getEnabledValues()[0]);
      }
    },
    [getEnabledValues, setInitialValue],
  );

  const selectRelative = useCallback(
    (direction: 1 | -1) => {
      const values = getEnabledValues();

      if (values.length === 0) {
        return;
      }

      const currentIndex = navigationRef.current ? values.indexOf(navigationRef.current) : -1;

      const nextIndex = cyclicIndex(values.length, currentIndex, direction)!;

      const nextValue = values[nextIndex];

      if (nextValue) {
        select(nextValue);
      }
    },
    [getEnabledValues, select],
  );

  const selectNext = useCallback(() => {
    selectRelative(1);
  }, [selectRelative]);

  const selectPrevious = useCallback(() => {
    selectRelative(-1);
  }, [selectRelative]);

  const selectFirst = useCallback(() => {
    const value = getEnabledValues()[0];

    if (value) {
      select(value);
    }
  }, [getEnabledValues, select]);

  const selectLast = useCallback(() => {
    const value = getEnabledValues().at(-1);

    if (value) {
      select(value);
    }
  }, [getEnabledValues, select]);

  const context = useMemo<TabsContextValue>(
    () => ({
      value: currentValue,
      canChange,

      select,
      activate,
      cancelActivation,
      resetNavigation,
      revealId: candidate === undefined ? undefined : triggers.current.get(candidate)?.node.id,
      setContent,

      registerTrigger,
      setTriggerDisabled,

      selectNext,
      selectPrevious,
      selectFirst,
      selectLast,
    }),
    [
      currentValue,
      canChange,
      select,
      activate,
      cancelActivation,
      resetNavigation,
      candidate,
      triggerVersion,
      setContent,
      registerTrigger,
      setTriggerDisabled,
      selectNext,
      selectPrevious,
      selectFirst,
      selectLast,
    ],
  );

  return context;
}
