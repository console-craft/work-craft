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
import { Box, type BoxProps } from "@/ui/primitives/box";
import { HStack, type HStackProps } from "@/ui/primitives/hstack";
import { Text, type TextProps } from "@/ui/primitives/text";
import { assignRef } from "@/ui/utils";

type ToggleRegistration = {
  value: string;
  disabled: boolean;
};

type ToggleGroupContextValue = {
  disabled: boolean;
  focused: boolean;
  activeValue?: string;
  canChange: boolean;

  isPressed: (value: string) => boolean;
  register: (item: ToggleRegistration) => () => void;
  refreshItems: () => void;
  focusValue: (value: string) => void;
  toggleValue: (value: string) => void;
};

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

const toggleAction = {
  names: ["space", "return", "linefeed"],
  hint: { keys: "Enter/Space", label: "Toggle" },
};

interface BaseToggleGroupProps extends Omit<
  BoxProps,
  "children" | "flexDirection" | "flexWrap" | "focusable"
> {
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
  children?: ReactNode;
}

export interface SingleToggleGroupProps extends BaseToggleGroupProps {
  type: "single";
  value?: string;
  onValueChange?: (value: string | undefined) => void;
}

export interface MultipleToggleGroupProps extends BaseToggleGroupProps {
  type: "multiple";
  value?: string[];
  onValueChange?: (value: string[]) => void;
}

export type ToggleGroupProps = SingleToggleGroupProps | MultipleToggleGroupProps;

export function ToggleGroup(props: ToggleGroupProps) {
  const {
    children,
    ref,
    disabled = false,
    orientation = "horizontal",
    focused,
    onKeyDown,
    gap = 0,
    alignItems,
    ...layoutProps
  } = props;

  const groupRef = useRef<BoxRenderable | null>(null);
  const itemsRef = useRef<ToggleRegistration[]>([]);
  const [, setItemsRevision] = useState(0);

  const pressedValuesRef = useRef<Set<string>>(new Set());

  pressedValuesRef.current =
    props.type === "single"
      ? new Set(props.value ? [props.value] : [])
      : new Set(props.value ?? []);

  const [isFocused, setIsFocused] = useState(false);
  const [activeValue, setActiveValue] = useState<string>();

  const getEnabledItems = useCallback(() => itemsRef.current.filter((item) => !item.disabled), []);

  useControlHints(
    groupRef,
    !disabled &&
      props.onValueChange &&
      activeValue &&
      getEnabledItems().some((item) => item.value === activeValue)
      ? [toggleAction.hint]
      : [],
  );

  const refreshItems = useCallback(() => {
    if (groupRef.current && !groupRef.current.isDestroyed) {
      setItemsRevision((revision) => revision + 1);
    }
  }, []);

  const register = useCallback(
    (item: ToggleRegistration) => {
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

  const isPressed = useCallback((value: string) => pressedValuesRef.current.has(value), []);

  const focusValue = useCallback((value: string) => {
    const item = itemsRef.current.find((item) => item.value === value && !item.disabled);

    if (!item) return;

    // Native focus initializes the candidate before the clicked value takes precedence.
    groupRef.current?.focus();
    setActiveValue(value);
  }, []);

  function toggleValue(value: string) {
    if (disabled) return;

    const item = itemsRef.current.find((item) => item.value === value);

    if (!item || item.disabled) return;

    if (props.type === "single") {
      props.onValueChange?.(props.value === value ? undefined : value);

      return;
    }

    const current = props.value ?? [];

    props.onValueChange?.(
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  const setGroupRef = useCallback(
    (node: BoxRenderable | null) => {
      groupRef.current = node;
      assignRef(ref, node);

      if (!node) return;

      const handleFocus = () => {
        setIsFocused(true);

        const items = getEnabledItems();

        const firstPressed = items.find((item) => pressedValuesRef.current.has(item.value));

        setActiveValue(firstPressed?.value ?? items[0]?.value);
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
    [ref, getEnabledItems],
  );

  useLayoutEffect(() => {
    if (!disabled) return;

    const group = groupRef.current;

    if (!group?.focused) return;

    group.focusable = true;
    group.blur();
    group.focusable = false;
  }, [disabled]);

  function moveActive(direction: -1 | 1) {
    const items = getEnabledItems();

    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item.value === activeValue);

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

    const activate = !event.repeated && noModifiers && toggleAction.names.includes(event.name);

    if (activate && activeValue) {
      event.preventDefault();
      toggleValue(activeValue);
    }
  }

  const context = useMemo<ToggleGroupContextValue>(
    () => ({
      disabled,
      focused: isFocused,
      activeValue,
      canChange: Boolean(props.onValueChange),

      isPressed,
      register,
      refreshItems,
      focusValue,
      toggleValue,
    }),
    [
      disabled,
      isFocused,
      activeValue,
      props.onValueChange,
      isPressed,
      register,
      refreshItems,
      focusValue,
      toggleValue,
    ],
  );

  return (
    <ToggleGroupContext.Provider value={context}>
      <Box
        {...layoutProps}
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
    </ToggleGroupContext.Provider>
  );
}

export interface ToggleProps extends Omit<HStackProps, "children" | "focusable" | "bg"> {
  value?: string;

  pressed?: boolean;
  disabled?: boolean;
  onPressedChange?: (pressed: boolean) => void;

  children?: TextProps["children"];
}

export function Toggle({
  children,
  ref,
  value,
  pressed = false,
  disabled = false,
  focused,
  onPressedChange,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseOut,
  paddingX = 1,
  ...props
}: ToggleProps) {
  const group = useContext(ToggleGroupContext);

  if (group && value === undefined) {
    throw new Error("<Toggle> inside <ToggleGroup> requires a value");
  }

  const toggleRef = useRef<BoxRenderable | null>(null);
  const mousePressedRef = useRef(false);

  const [isFocused, setIsFocused] = useState(false);

  const isGrouped = group !== null;

  const isDisabled = disabled || Boolean(group?.disabled);
  useControlHints(
    toggleRef,
    !isGrouped && !isDisabled && onPressedChange ? [toggleAction.hint] : [],
  );

  const isPressed = group ? group.isPressed(value!) : pressed;

  const isActive = group ? group.focused && group.activeValue === value : isFocused;

  const registrationRef = useRef<ToggleRegistration>({
    value: value ?? "",
    disabled: isDisabled,
  });

  registrationRef.current.value = value ?? "";
  registrationRef.current.disabled = isDisabled;

  useLayoutEffect(() => group?.register(registrationRef.current), [group?.register]);
  useLayoutEffect(() => group?.refreshItems(), [group?.refreshItems, value, isDisabled]);

  const setToggleRef = useCallback(
    (node: BoxRenderable | null) => {
      toggleRef.current = node;
      assignRef(ref, node);

      if (!node) return;

      if (isGrouped) {
        return () => {
          if (toggleRef.current === node) {
            toggleRef.current = null;
          }

          assignRef(ref, null);
        };
      }

      setIsFocused(node.focused);

      const handleFocus = () => setIsFocused(true);
      const handleBlur = () => setIsFocused(false);

      node.on(RenderableEvents.FOCUSED, handleFocus);
      node.on(RenderableEvents.BLURRED, handleBlur);

      return () => {
        node.off(RenderableEvents.FOCUSED, handleFocus);
        node.off(RenderableEvents.BLURRED, handleBlur);

        if (toggleRef.current === node) {
          toggleRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref, isGrouped],
  );

  useLayoutEffect(() => {
    mousePressedRef.current = false;

    if (isGrouped || !isDisabled) return;

    const toggle = toggleRef.current;

    if (!toggle?.focused) return;

    toggle.focusable = true;
    toggle.blur();
    toggle.focusable = false;
  }, [isDisabled, isGrouped]);

  const backgroundColor = isDisabled
    ? "muted"
    : isActive
      ? "focus"
      : isPressed
        ? "primary"
        : "secondary";

  const textColor = isDisabled
    ? "mutedForeground"
    : isActive
      ? isPressed
        ? "primary"
        : "focusForeground"
      : isPressed
        ? "primaryForeground"
        : "secondaryForeground";

  function toggle() {
    if (isDisabled) return;

    if (group) {
      group.toggleValue(value!);
      return;
    }

    onPressedChange?.(!pressed);
  }

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || isGrouped || isDisabled || !onPressedChange || event.repeated) {
      return;
    }

    const noModifiers = !event.ctrl && !event.meta && !event.super && !event.shift;

    if (noModifiers && toggleAction.names.includes(event.name)) {
      event.preventDefault();
      toggle();
    }
  }

  function handleMouseDown(this: BoxRenderable, event: OpenTUIMouseEvent) {
    onMouseDown?.call(this, event);

    if (event.defaultPrevented || isDisabled || event.button !== MouseButton.LEFT) {
      return;
    }

    mousePressedRef.current = true;

    if (group) {
      group.focusValue(value!);
    }
  }

  function handleMouseUp(this: BoxRenderable, event: OpenTUIMouseEvent) {
    const wasPressed = mousePressedRef.current;
    mousePressedRef.current = false;

    onMouseUp?.call(this, event);

    if (event.defaultPrevented || isDisabled || !wasPressed || event.button !== MouseButton.LEFT) {
      return;
    }

    toggle();
  }

  function handleMouseOut(this: BoxRenderable, event: OpenTUIMouseEvent) {
    mousePressedRef.current = false;
    onMouseOut?.call(this, event);
  }

  return (
    <HStack
      {...props}
      ref={setToggleRef}
      paddingX={paddingX}
      focusable={!isGrouped && !isDisabled}
      focused={isGrouped || isDisabled ? false : focused}
      bg={backgroundColor}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Text fg={textColor}>{children}</Text>
    </HStack>
  );
}
