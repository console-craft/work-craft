import {
  type BoxRenderable,
  CliRenderEvents,
  type KeyEvent,
  MouseButton,
  type MouseEvent,
  type Renderable,
  RenderableEvents,
  TextBufferRenderable,
} from "@opentui/core";
import { Gutter, Unit } from "@opentui/core/yoga";
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
  useState,
} from "react";

import { HorizontalScroller } from "@/ui/components/horizontal-scroller";
import { type ControlHintSource, useControlHints } from "@/ui/control-hints";
import { useNativeFocus } from "@/ui/focus-manager";
import { focusRenderable, getFocusableRenderables, isEligibleFocusTarget } from "@/ui/focus-utils";
import { Box } from "@/ui/primitives/box";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import { consumePrimaryPointerPress } from "@/ui/primitives/scroll-area";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theme";
import { assignRef, getContentWidth, isTextContent } from "@/ui/utils";

interface TabsTriggerRecord {
  disabled: boolean;
  node: BoxRenderable;
}

interface TabsContextValue {
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

function hasFocusableTarget(node: Renderable): boolean {
  return (
    !node.isDestroyed &&
    node.visible &&
    (node.focusable || node.getChildren().some(hasFocusableTarget))
  );
}

function getRowGap(node: Renderable): number {
  const gap = node.getGap(Gutter.Column);
  return Number.isFinite(gap.value)
    ? gap.value * (gap.unit === Unit.Percent ? node.width / 100 : 1)
    : 0;
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
  const renderer = useRenderer();
  const controlled = Object.prototype.hasOwnProperty.call(props, "value");

  const { value, defaultValue, onValueChange, onActivate, children, ...stackProps } = props;

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
    const values: string[] = [];
    function visit(node: Renderable) {
      const trigger = byNode.get(node as BoxRenderable);
      if (trigger && !trigger.disabled) {
        values.push(trigger.value);
      }
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
    visit(renderer.root);
    return values;
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
  const [labelWidth, setLabelWidth] = useState(0);
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

  useLayoutEffect(() => {
    if (props.flexBasis !== 0) {
      return;
    }
    function measureLabel() {
      const label = labelRef.current;
      if (!label) {
        return;
      }
      const children = label.getChildren().filter((child) => child.visible);
      const width =
        children.reduce(
          (total, child) =>
            total + (child instanceof TextBufferRenderable ? child.scrollWidth : child.width),
          0,
        ) +
        Math.max(0, children.length - 1) * getRowGap(label) +
        label.getLayout().width -
        getContentWidth(label);
      const row = triggerRef.current?.parent;
      const siblings = row?.getChildren() ?? [];
      const expanded = siblings.filter(
        (node) => node.getFlexBasis().value === 0 && node.getFlexGrow() > 0,
      );
      const weight = expanded.reduce((total, node) => total + node.getFlexGrow(), 0);
      const fixedWidth = siblings
        .filter((node) => !expanded.includes(node))
        .reduce((total, node) => total + node.width, 0);
      const available =
        (listRef.current?.width ?? 0) -
        fixedWidth -
        Math.max(0, siblings.length - 1) * (row ? getRowGap(row) : 0);
      const share = weight > 0 ? (available * (props.flexGrow ?? 0)) / weight : 0;
      // A minimum in Yoga's scroll layout becomes a flex base; apply it only when needed.
      setLabelWidth(width > share ? width : 0);
    }
    renderer.on(CliRenderEvents.FRAME, measureLabel);
    return () => {
      renderer.off(CliRenderEvents.FRAME, measureLabel);
    };
  }, [renderer, props.flexBasis, props.flexGrow, listRef]);

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
