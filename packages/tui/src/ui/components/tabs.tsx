import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent,
  RenderableEvents,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { HorizontalScroller } from "@/ui/components/horizontal-scroller";
import { useTabLabelWidth } from "@/ui/components/tab-measurement";
import { type TabsContextValue, useTabsState } from "@/ui/components/tabs-state";
import { type ControlHintSource, useControlHints } from "@/ui/control-hints";
import { useNativeFocus } from "@/ui/focus-manager";
import { consumePrimaryPointerPress, usePointerObservation } from "@/ui/pointer";
import { Box } from "@/ui/primitives/box";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theme";
import { assignRef, isTextContent } from "@/ui/utils";

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
  listRef: RefObject<BoxRenderable | null>;
}

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList() {
  const context = useContext(TabsListContext);

  if (!context) {
    throw new Error("TabsTrigger must be used within <TabsList>");
  }

  return context;
}

export interface TabsProps extends StackProps {
  /** Passing value, including undefined, selects controlled state. */
  value?: string;
  defaultValue?: string;
  /** Controlled state is read-only when this callback is absent. */
  onValueChange?: (value: string) => void;
  /** Owns requested content entry instead of generic panel focus, for keyboard and mouse. */
  onActivate?: (value: string) => void;
}

export function Tabs(props: TabsProps) {
  usePointerObservation();
  const controlled = Object.prototype.hasOwnProperty.call(props, "value");

  const { value, defaultValue, onValueChange, onActivate, children, ...stackProps } = props;

  const context = useTabsState({ value, defaultValue, onValueChange, onActivate, controlled });

  return (
    <TabsContext.Provider value={context}>
      <Stack gap={0} {...stackProps}>
        {children}
      </Stack>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends Omit<HStackProps, "focusable"> {
  /** Replaces default hints; an empty array or getter result suppresses them. */
  controlHints?: ControlHintSource;
  /** Browsing origin on native focus, without selecting. Defaults to selection if absent/ineligible. */
  refocusValue?: string;
  /** Contained wheel/primary-arrow intent, including edges; does not select or focus. */
  onScrollInteraction?: () => void;
}

export function TabsList({
  children,
  ref,
  id,
  gap = 0,
  onKeyDown,
  controlHints,
  refocusValue,
  onScrollInteraction,
  ...props
}: TabsListProps) {
  const {
    value,
    canChange,
    activate,
    cancelActivation,
    resetNavigation,
    revealId,
    selectNext,
    selectPrevious,
    selectFirst,
    selectLast,
  } = useTabs();
  const generatedId = useId();
  const listRef = useRef<BoxRenderable | null>(null);
  const refocusValueRef = useRef(refocusValue);
  refocusValueRef.current = refocusValue;
  const nativeFocus = useNativeFocus();
  const focused = nativeFocus !== null && nativeFocus === listRef.current;
  useControlHints(
    listRef,
    controlHints ?? [
      ...(canChange
        ? [
            { keys: "→/l", label: "Next" },
            { keys: "←/h", label: "Previous" },
            { keys: "Home/g", label: "First" },
            { keys: "End/G", label: "Last" },
          ]
        : []),
      ...(value !== undefined ? [{ keys: "Enter/Space", label: "Activate" }] : []),
    ],
  );

  const setListRef = useCallback(
    (node: BoxRenderable | null) => {
      listRef.current = node;
      assignRef(ref, node);
      const resetOnFocus = () => resetNavigation(refocusValueRef.current);
      node?.on(RenderableEvents.FOCUSED, resetOnFocus);
      return () => {
        node?.off(RenderableEvents.FOCUSED, resetOnFocus);
        if (listRef.current === node) {
          listRef.current = null;
        }
        assignRef(ref, null);
      };
    },
    [ref, resetNavigation],
  );

  function handleKeyDown(key: KeyEvent) {
    cancelActivation();
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

  const context = useMemo<TabsListContextValue>(() => ({ focused, listRef }), [focused]);

  return (
    <TabsListContext.Provider value={context}>
      <HStack
        height={2}
        flexShrink={0}
        bg="muted"
        {...props}
        id={id}
        ref={setListRef}
        focusable
        gap={0}
        onKeyDown={handleKeyDown}
      >
        <HorizontalScroller
          id={`${id ?? generatedId}:scroller`}
          height={2}
          width="100%"
          minWidth={0}
          revealId={revealId}
          onScrollInteraction={() => {
            cancelActivation();
            onScrollInteraction?.();
          }}
        >
          <HStack gap={gap} minWidth="100%" height={2} flexShrink={0}>
            {children}
          </HStack>
        </HorizontalScroller>
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
  id,
  ref,
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
  const { focused, listRef } = useTabsList();
  const mousePressedRef = useRef<number | undefined>(undefined);
  const renderer = useRenderer();
  const labelRef = useRef<BoxRenderable | null>(null);
  const generatedId = useId();
  const triggerRef = useRef<BoxRenderable | null>(null);

  const setTriggerRef = useCallback(
    (node: BoxRenderable | null) => {
      triggerRef.current = node;
      assignRef(ref, node);
      return () => {
        triggerRef.current = null;
        assignRef(ref, null);
      };
    },
    [ref],
  );

  const labelWidth = useTabLabelWidth({
    labelRef,
    triggerRef,
    listRef,
    flexBasis: props.flexBasis,
    flexGrow: props.flexGrow,
  });

  useLayoutEffect(() => {
    if (triggerRef.current) {
      return tabs.registerTrigger(value, disabled, triggerRef.current);
    }
  }, [tabs.registerTrigger, value]);

  useLayoutEffect(() => {
    if (disabled) {
      mousePressedRef.current = undefined;
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
    tabs.cancelActivation();
    mousePressedRef.current = undefined;
    const press =
      event.button === MouseButton.LEFT ? consumePrimaryPointerPress(renderer, event) : undefined;
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

    mousePressedRef.current = press;
  }

  function handleMouseUp(this: BoxRenderable, event: MouseEvent) {
    const wasPressed = mousePressedRef.current;
    mousePressedRef.current = undefined;
    const press =
      event.button === MouseButton.LEFT ? consumePrimaryPointerPress(renderer, event) : undefined;
    onMouseUp?.call(this, event);
    if (
      disabled ||
      !tabs.canChange ||
      event.defaultPrevented ||
      event.propagationStopped ||
      wasPressed === undefined ||
      wasPressed !== press ||
      !isWithinTrigger(this, event) ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }
    tabs.select(value);
    tabs.activate(value);
  }

  function handleMouseOut(this: BoxRenderable, event: MouseEvent) {
    // Child hit-target crossings also produce mouse-out events.
    if (!isWithinTrigger(this, event)) {
      mousePressedRef.current = undefined;
    }
    onMouseOut?.call(this, event);
  }

  return (
    <HStack
      {...props}
      id={id ?? generatedId}
      ref={setTriggerRef}
      flexShrink={0}
      // Yoga's scrolling ancestor otherwise treats zero flex-basis as label-natural width.
      width={props.width ?? (props.flexBasis === 0 ? labelWidth : undefined)}
      focusable={false}
      paddingX={0}
      gap={0}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Stack gap={0} flexGrow={1} minWidth={0}>
        <HStack
          ref={labelRef}
          paddingX={paddingX}
          gap={gap}
          justifyContent={justifyContent}
          bg={background}
        >
          {isTextContent(children) ? (
            <Text fg={foreground} wrapMode="none" flexShrink={0}>
              {children}
            </Text>
          ) : (
            children
          )}
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
