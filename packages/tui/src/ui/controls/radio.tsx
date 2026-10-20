import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent as OpenTUIMouseEvent,
  RenderableEvents,
} from "@opentui/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useControlHints } from "@/ui/control-hints";
import { symbols } from "@/ui/icons/symbols";
import { Box, type BoxProps } from "@/ui/primitives/box";
import { HStack, type HStackProps } from "@/ui/primitives/hstack";
import { Text, type TextProps } from "@/ui/primitives/text";
import { assignRef, setDisabled } from "@/ui/utils";

type RadioRegistration = {
  node: BoxRenderable | null;
  value: string;
  disabled: boolean;
};

type RadioGroupContextValue = {
  value?: string;
  disabled: boolean;
  focused: boolean;
  activeValue?: string;

  register: (item: RadioRegistration) => () => void;
  refreshItems: () => void;
  focusValue: (value: string) => void;
  selectValue: (value: string) => void;
};

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

const selectAction = { name: "space", hint: { keys: "Space", label: "Select" } };

function useRadioGroup() {
  const context = useContext(RadioGroupContext);

  if (!context) {
    throw new Error("<Radio> must be used inside <RadioGroup>");
  }

  return context;
}

export interface RadioGroupProps extends Omit<
  BoxProps,
  "children" | "flexDirection" | "flexWrap" | "focusable"
> {
  value?: string;
  disabled?: boolean;
  orientation?: "vertical" | "horizontal";
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}

export function RadioGroup({
  children,
  ref,
  value,
  disabled = false,
  orientation = "vertical",
  onValueChange,
  onKeyDown,
  focused,
  gap = orientation === "horizontal" ? 2 : 0,
  alignItems,
  ...props
}: RadioGroupProps) {
  const groupRef = useRef<BoxRenderable | null>(null);
  const itemsRef = useRef<RadioRegistration[]>([]);
  const [, setItemsRevision] = useState(0);

  const valueRef = useRef(value);
  const disabledRef = useRef(disabled);
  const onValueChangeRef = useRef(onValueChange);

  valueRef.current = value;
  disabledRef.current = disabled;
  onValueChangeRef.current = onValueChange;

  const [isFocused, setIsFocused] = useState(false);
  const [activeValue, setActiveValue] = useState<string>();

  function getEnabledItems() {
    return itemsRef.current.filter((item) => !item.disabled && item.node);
  }

  useControlHints(
    groupRef,
    !disabled &&
      onValueChange &&
      activeValue &&
      getEnabledItems().some((item) => item.value === activeValue)
      ? [selectAction.hint]
      : [],
  );

  const refreshItems = useCallback(() => {
    if (groupRef.current && !groupRef.current.isDestroyed) {
      setItemsRevision((revision) => revision + 1);
    }
  }, []);

  const register = useCallback(
    (item: RadioRegistration) => {
      itemsRef.current.push(item);
      refreshItems();

      return () => {
        const index = itemsRef.current.indexOf(item);

        if (index !== -1) {
          itemsRef.current.splice(index, 1);
          refreshItems();
        }
      };
    },
    [refreshItems],
  );

  const focusValue = useCallback((nextValue: string) => {
    if (disabledRef.current) return;

    const item = itemsRef.current.find(
      (item) => item.value === nextValue && !item.disabled && item.node,
    );

    if (!item) return;

    // Native focus initializes the candidate before the clicked value takes precedence.
    groupRef.current?.focus();
    setActiveValue(nextValue);
  }, []);

  const selectValue = useCallback((nextValue: string) => {
    if (disabledRef.current || nextValue === valueRef.current) {
      return;
    }

    onValueChangeRef.current?.(nextValue);
  }, []);

  const setGroupRef = useCallback(
    (node: BoxRenderable | null) => {
      groupRef.current = node;
      assignRef(ref, node);

      if (!node) return;

      const handleFocus = () => {
        setIsFocused(true);

        const items = getEnabledItems();

        const selectedItem = items.find((item) => item.value === valueRef.current);

        setActiveValue(selectedItem?.value ?? items[0]?.value);
      };

      const handleBlur = () => {
        setIsFocused(false);
      };

      node.on(RenderableEvents.FOCUSED, handleFocus);
      node.on(RenderableEvents.BLURRED, handleBlur);

      // The focused prop is applied before this ref subscribes to native events.
      if (node.focused) {
        handleFocus();
      }

      return () => {
        node.off(RenderableEvents.FOCUSED, handleFocus);
        node.off(RenderableEvents.BLURRED, handleBlur);

        if (groupRef.current === node) {
          groupRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (!disabled) return;

    const group = groupRef.current;

    if (!group?.focused) return;

    setDisabled(group, true);
  }, [disabled]);

  function moveActive(direction: -1 | 1) {
    const items = getEnabledItems();

    if (items.length === 0) return;

    const currentValue = activeValue ?? value;

    const currentIndex = items.findIndex((item) => item.value === currentValue);

    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : items.length - 1
        : (currentIndex + direction + items.length) % items.length;

    setActiveValue(items[nextIndex].value);
  }

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    const noModifiers = !event.ctrl && !event.meta && !event.super && !event.shift;

    const next =
      (event.ctrl && !event.meta && !event.super && !event.shift && event.name === "n") ||
      (noModifiers && ["down", "right", "j", "l"].includes(event.name));

    const previous =
      (event.ctrl && !event.meta && !event.super && !event.shift && event.name === "p") ||
      (noModifiers && ["up", "left", "k", "h"].includes(event.name));

    if (next) {
      event.preventDefault();
      moveActive(1);
      return;
    }

    if (previous) {
      event.preventDefault();
      moveActive(-1);
      return;
    }

    if (event.name === selectAction.name && !event.repeated && activeValue) {
      event.preventDefault();
      selectValue(activeValue);
    }
  }

  const context = useMemo<RadioGroupContextValue>(
    () => ({
      value,
      disabled,
      focused: isFocused,
      activeValue,
      register,
      refreshItems,
      focusValue,
      selectValue,
    }),
    [value, disabled, isFocused, activeValue, register, refreshItems, focusValue, selectValue],
  );

  return (
    <RadioGroupContext.Provider value={context}>
      <Box
        {...props}
        ref={setGroupRef}
        flexDirection={orientation === "horizontal" ? "row" : "column"}
        flexWrap="no-wrap"
        gap={gap}
        alignItems={alignItems ?? (orientation === "horizontal" ? "center" : "stretch")}
        focusable={!disabled}
        focused={disabled ? false : focused}
        onKeyDown={handleKeyDown}
      >
        {children}
      </Box>
    </RadioGroupContext.Provider>
  );
}

export interface RadioProps extends Omit<HStackProps, "children" | "focusable" | "focused"> {
  value: string;
  disabled?: boolean;
  children?: TextProps["children"];
}

export function Radio({
  children,
  ref,
  value,
  disabled = false,
  bg,
  onMouseDown,
  onMouseUp,
  onMouseOut,
  ...props
}: RadioProps) {
  const group = useRadioGroup();

  const mousePressedRef = useRef(false);

  const isDisabled = group.disabled || disabled;
  const isSelected = group.value === value;
  const isActive = group.focused && group.activeValue === value;

  const registrationRef = useRef<RadioRegistration>({
    node: null,
    value,
    disabled: isDisabled,
  });

  registrationRef.current.value = value;
  registrationRef.current.disabled = isDisabled;

  // Candidate changes can commit without rerendering the owning group.
  useLayoutEffect(() => group.register(registrationRef.current), [group.register]);
  useLayoutEffect(group.refreshItems, [group.refreshItems, value, isDisabled]);

  const setRadioRef = useCallback(
    (node: BoxRenderable | null) => {
      registrationRef.current.node = node;
      assignRef(ref, node);

      if (!node) return;

      return () => {
        if (registrationRef.current.node === node) {
          registrationRef.current.node = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  const indicator = isSelected ? symbols.circleDot : symbols.circle;

  const indicatorColor = isDisabled
    ? "secondary"
    : isActive
      ? isSelected
        ? "selection"
        : "foreground"
      : isSelected
        ? "selection"
        : "mutedForeground";

  const labelColor = isDisabled ? "mutedForeground" : isActive ? "focusForeground" : "foreground";

  function handleMouseDown(this: BoxRenderable, event: OpenTUIMouseEvent) {
    onMouseDown?.call(this, event);

    if (event.defaultPrevented || isDisabled || event.button !== MouseButton.LEFT) {
      return;
    }

    mousePressedRef.current = true;
    group.focusValue(value);
  }

  function handleMouseUp(this: BoxRenderable, event: OpenTUIMouseEvent) {
    const wasPressed = mousePressedRef.current;
    mousePressedRef.current = false;

    onMouseUp?.call(this, event);

    if (event.defaultPrevented || isDisabled || !wasPressed || event.button !== MouseButton.LEFT) {
      return;
    }

    group.selectValue(value);
  }

  function handleMouseOut(this: BoxRenderable, event: OpenTUIMouseEvent) {
    mousePressedRef.current = false;
    onMouseOut?.call(this, event);
  }

  return (
    <HStack
      {...props}
      ref={setRadioRef}
      focusable={false}
      bg={isActive ? "focus" : bg}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Text fg={indicatorColor}>{indicator}</Text>
      <Text fg={labelColor}>{children}</Text>
    </HStack>
  );
}
