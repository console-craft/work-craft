import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent,
  type Renderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useControlHints } from "@/ui/control-hints";
import { useNativeFocus } from "@/ui/focus-manager";
import { focusRenderable, getFocusableRenderables, isEligibleFocusTarget } from "@/ui/focus-utils";
import { Box } from "@/ui/primitives/box";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theme";
import { assignRef, isTextContent } from "@/ui/utils";

interface TabsTriggerRecord {
  disabled: boolean;
}

interface TabsContextValue {
  value: string | undefined;
  canChange: boolean;

  select: (value: string) => void;
  activate: () => boolean;
  setContent: (value: string, content: BoxRenderable | null) => void;

  registerTrigger: (value: string, disabled: boolean) => () => void;

  setTriggerDisabled: (value: string, disabled: boolean) => void;

  selectNext: () => void;
  selectPrevious: () => void;
  selectFirst: () => void;
  selectLast: () => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const context = useContext(TabsContext);

  if (!context) {
    throw new Error("Tabs components must be used within <Tabs>");
  }

  return context;
}

interface TabsListContextValue {
  focused: boolean;
}

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList() {
  const context = useContext(TabsListContext);

  if (!context) {
    throw new Error("TabsTrigger must be used within <TabsList>");
  }

  return context;
}

function hasFocusableTarget(node: Renderable): boolean {
  return (
    !node.isDestroyed &&
    node.visible &&
    (node.focusable || node.getChildren().some(hasFocusableTarget))
  );
}

export interface TabsProps extends StackProps {
  /** Passing value, including undefined, selects controlled state. */
  value?: string;
  defaultValue?: string;
  /** Controlled state is read-only when this callback is absent. */
  onValueChange?: (value: string) => void;
}

export function Tabs(props: TabsProps) {
  const renderer = useRenderer();
  const controlled = Object.prototype.hasOwnProperty.call(props, "value");

  const { value, defaultValue, onValueChange, children, ...stackProps } = props;

  const [internalValue, setInternalValue] = useState<string | undefined>(defaultValue);

  const currentValue = controlled ? value : internalValue;
  const canChange = !controlled || onValueChange !== undefined;

  const triggers = useRef(new Map<string, TabsTriggerRecord>());
  const contents = useRef(new Map<string, BoxRenderable>());
  const pendingActivation = useRef<{ value: string; source: Renderable } | null>(null);

  const controlledRef = useRef(controlled);
  const currentValueRef = useRef(currentValue);
  const onValueChangeRef = useRef(onValueChange);

  controlledRef.current = controlled;
  currentValueRef.current = currentValue;
  onValueChangeRef.current = onValueChange;

  const setContent = useCallback((value: string, content: BoxRenderable | null) => {
    if (content) {
      contents.current.set(value, content);
    } else {
      contents.current.delete(value);
    }
  }, []);

  const activate = useCallback((): boolean => {
    const value = currentValueRef.current;
    if (value === undefined || triggers.current.get(value)?.disabled !== false) {
      return false;
    }
    const content = contents.current.get(value);
    if (!content || content.isDestroyed) {
      return false;
    }
    // Buffered switching can select a panel before React commits its visibility.
    if (!content.visible) {
      const source = renderer.currentFocusedRenderable;
      if (!source) {
        return false;
      }
      if (!content.focusable && !content.getChildren().some(hasFocusableTarget)) {
        return false;
      }
      pendingActivation.current = { value, source };
      return true;
    }
    const target = getFocusableRenderables(content)[0] ?? content;
    return isEligibleFocusTarget(target, content) && focusRenderable(renderer, target) !== null;
  }, [renderer]);

  useLayoutEffect(() => {
    const requested = pendingActivation.current;
    pendingActivation.current = null;
    if (
      requested !== null &&
      requested.value === currentValue &&
      requested.source === renderer.currentFocusedRenderable
    ) {
      activate();
    }
  });

  const getEnabledValues = useCallback(() => {
    return [...triggers.current.entries()]
      .filter(([, trigger]) => !trigger.disabled)
      .map(([value]) => value);
  }, []);

  const setInitialValue = useCallback((value: string | undefined) => {
    if (controlledRef.current) {
      return;
    }

    pendingActivation.current = null;
    currentValueRef.current = value;
    setInternalValue(value);
  }, []);

  const select = useCallback((value: string) => {
    const trigger = triggers.current.get(value);

    if (!trigger || trigger.disabled) {
      return;
    }

    if (currentValueRef.current === value) {
      return;
    }

    pendingActivation.current = null;
    if (!controlledRef.current) {
      currentValueRef.current = value;
      setInternalValue(value);
    }

    onValueChangeRef.current?.(value);
  }, []);

  const registerTrigger = useCallback(
    (value: string, disabled: boolean) => {
      triggers.current.set(value, { disabled });

      if (!controlledRef.current && currentValueRef.current === undefined && !disabled) {
        setInitialValue(value);
      }

      return () => {
        const selected = currentValueRef.current === value;

        triggers.current.delete(value);

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

      const currentIndex = currentValueRef.current ? values.indexOf(currentValueRef.current) : -1;

      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : values.length - 1
          : (currentIndex + direction + values.length) % values.length;

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
      setContent,
      registerTrigger,
      setTriggerDisabled,
      selectNext,
      selectPrevious,
      selectFirst,
      selectLast,
    ],
  );

  return (
    <TabsContext.Provider value={context}>
      <Stack gap={0} {...stackProps}>
        {children}
      </Stack>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends Omit<HStackProps, "focusable"> {}

export function TabsList({ children, ref, gap = 0, onKeyDown, ...props }: TabsListProps) {
  const { value, canChange, activate, selectNext, selectPrevious, selectFirst, selectLast } =
    useTabs();
  const listRef = useRef<BoxRenderable | null>(null);
  const nativeFocus = useNativeFocus();
  const focused = nativeFocus !== null && nativeFocus === listRef.current;
  useControlHints(listRef, [
    ...(canChange
      ? [
          { keys: "→/l", label: "Next" },
          { keys: "←/h", label: "Previous" },
          { keys: "Home/g", label: "First" },
          { keys: "End/G", label: "Last" },
        ]
      : []),
    ...(value !== undefined ? [{ keys: "Enter/Space", label: "Activate" }] : []),
  ]);

  const setListRef = useCallback(
    (node: BoxRenderable | null) => {
      listRef.current = node;
      assignRef(ref, node);
      return () => {
        if (listRef.current === node) {
          listRef.current = null;
        }
        assignRef(ref, null);
      };
    },
    [ref],
  );

  function handleKeyDown(key: KeyEvent) {
    onKeyDown?.(key);

    if (key.defaultPrevented || key.propagationStopped) {
      return;
    }

    const hasNonShiftModifier = key.ctrl || key.meta || key.option || key.super || key.hyper;

    if (hasNonShiftModifier) {
      return;
    }

    const activating = ["return", "enter", "linefeed", "space"].includes(key.name);
    if (!canChange && !activating) {
      return;
    }

    let handled = true;

    if (key.name === "g" && key.shift) {
      selectLast();
    } else if (key.shift) {
      handled = false;
    } else {
      switch (key.name) {
        case "return":
        case "enter":
        case "linefeed":
        case "space":
          handled = !key.repeated && activate();
          break;
        case "home":
        case "g":
          selectFirst();
          break;
        case "end":
          selectLast();
          break;
        case "right":
        case "l":
          selectNext();
          break;
        case "left":
        case "h":
          selectPrevious();
          break;
        default:
          handled = false;
      }
    }

    if (handled) {
      key.preventDefault();
      key.stopPropagation();
    }
  }

  const context = useMemo<TabsListContextValue>(() => ({ focused }), [focused]);

  return (
    <TabsListContext.Provider value={context}>
      <HStack
        height={2}
        flexShrink={0}
        bg="muted"
        {...props}
        ref={setListRef}
        focusable
        gap={gap}
        onKeyDown={handleKeyDown}
      >
        {children}
      </HStack>
    </TabsListContext.Provider>
  );
}

export interface TabsTriggerProps extends Omit<HStackProps, "focusable"> {
  /** Trigger values must be unique within their tabs. */
  value: string;
  disabled?: boolean;
  /** Selected-tab color; inactive tabs keep their secondary background. */
  bg?: ThemeColor;
}

function isWithinTrigger(trigger: BoxRenderable, event: MouseEvent): boolean {
  return (
    event.x >= trigger.screenX &&
    event.x < trigger.screenX + trigger.width &&
    event.y >= trigger.screenY &&
    event.y < trigger.screenY + trigger.height
  );
}

export function TabsTrigger({
  value,
  disabled = false,
  children,
  bg,
  paddingX = 1,
  gap = 0,
  justifyContent = "flex-start",
  onMouseDown,
  onMouseUp,
  onMouseOut,
  ...props
}: TabsTriggerProps) {
  const tabs = useTabs();
  const { focused } = useTabsList();
  const mousePressedRef = useRef(false);

  useLayoutEffect(() => {
    return tabs.registerTrigger(value, disabled);
  }, [tabs.registerTrigger, value]);

  useLayoutEffect(() => {
    if (disabled) {
      mousePressedRef.current = false;
    }
    tabs.setTriggerDisabled(value, disabled);
  }, [tabs.setTriggerDisabled, value, disabled]);

  const selected = tabs.value === value;
  const primary = bg ?? "primary";

  const foreground = disabled
    ? "mutedForeground"
    : selected && focused
      ? primary
      : selected
        ? "primaryForeground"
        : "foreground";

  const background = disabled
    ? "muted"
    : selected && focused
      ? "focus"
      : selected
        ? primary
        : "secondary";
  const borderColor = disabled ? "secondary" : selected ? primary : "mutedForeground";

  function handleMouseDown(this: BoxRenderable, event: MouseEvent) {
    mousePressedRef.current = false;
    onMouseDown?.call(this, event);

    if (
      disabled ||
      !tabs.canChange ||
      event.defaultPrevented ||
      event.propagationStopped ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }

    mousePressedRef.current = true;
  }

  function handleMouseUp(this: BoxRenderable, event: MouseEvent) {
    const wasPressed = mousePressedRef.current;
    mousePressedRef.current = false;
    onMouseUp?.call(this, event);
    if (
      disabled ||
      !tabs.canChange ||
      event.defaultPrevented ||
      event.propagationStopped ||
      !wasPressed ||
      !isWithinTrigger(this, event) ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }
    tabs.select(value);
  }

  function handleMouseOut(this: BoxRenderable, event: MouseEvent) {
    // Child hit-target crossings also produce mouse-out events.
    if (!isWithinTrigger(this, event)) {
      mousePressedRef.current = false;
    }
    onMouseOut?.call(this, event);
  }

  return (
    <HStack
      {...props}
      focusable={false}
      paddingX={0}
      gap={0}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Stack gap={0} flexGrow={1} minWidth={0}>
        <HStack paddingX={paddingX} gap={gap} justifyContent={justifyContent} bg={background}>
          {isTextContent(children) ? <Text fg={foreground}>{children}</Text> : children}
        </HStack>
        <Box
          height={1}
          bg="background"
          border={["top"]}
          borderStyle="heavy"
          borderColor={borderColor}
        />
      </Stack>
    </HStack>
  );
}

export interface TabsContentProps extends Omit<StackProps, "visible"> {
  value: string;
}

/** Keeps panel state mounted and provides a focus fallback when it has no eligible controls. */
export function TabsContent({ value, ref, ...props }: TabsContentProps) {
  const tabs = useTabs();
  const contentRef = useRef<BoxRenderable | null>(null);
  const setContentRef = useCallback(
    (node: BoxRenderable | null) => {
      contentRef.current = node;
      tabs.setContent(value, node);
      assignRef(ref, node);
      return () => {
        if (contentRef.current === node) {
          contentRef.current = null;
          tabs.setContent(value, null);
        }
        assignRef(ref, null);
      };
    },
    [tabs.setContent, ref, value],
  );

  return <Stack focusable {...props} ref={setContentRef} visible={tabs.value === value} />;
}
