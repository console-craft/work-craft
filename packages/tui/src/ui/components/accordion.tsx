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
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useControlHints } from "@/ui/control-hints";
import { useNativeFocus } from "@/ui/focus-manager";
import { focusRenderable, getFocusableRenderables } from "@/ui/focus-utils";
import { symbols } from "@/ui/icons/symbols";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { assignRef, isTextContent, setDisabled } from "@/ui/utils";

type AccordionBaseProps = Omit<StackProps, "children"> & {
  children: ReactNode;
};

export type AccordionSingleProps = AccordionBaseProps & {
  multiple?: false;
  /** Passing value, including undefined, selects controlled state. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | undefined) => void;
};

export type AccordionMultipleProps = AccordionBaseProps & {
  multiple: true;
  /** Controlled state is read-only when onValueChange is absent. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

export type AccordionProps = AccordionSingleProps | AccordionMultipleProps;

interface AccordionContextValue {
  canChange: boolean;
  isOpen: (value: string) => boolean;
  setOpen: (value: string, open: boolean) => void;
  toggle: (value: string) => void;

  setTrigger: (value: string, trigger: Renderable | null) => void;

  focusNext: (value: string) => void;
  focusPrevious: (value: string) => void;
  focusFirst: () => void;
  focusLast: () => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordion() {
  const context = useContext(AccordionContext);

  if (!context) {
    throw new Error("Accordion components must be used within <Accordion>");
  }

  return context;
}

interface AccordionItemContextValue {
  value: string;
  open: boolean;
  disabled: boolean;
}

const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

function useAccordionItem() {
  const context = useContext(AccordionItemContext);

  if (!context) {
    throw new Error("AccordionTrigger and AccordionContent must be used within <AccordionItem>");
  }

  return context;
}

interface AccordionRootProps extends StackProps {
  canChange: boolean;
  openValues: Set<string>;
  /** Omit open to toggle against the latest local value. */
  setItemOpen: (value: string, open?: boolean) => void;
}

function AccordionRoot({
  children,
  ref,
  canChange,
  openValues,
  setItemOpen,
  ...props
}: AccordionRootProps) {
  const renderer = useRenderer();
  const rootRef = useRef<BoxRenderable | null>(null);
  const triggers = useRef(new Map<string, Renderable>());

  const setRootRef = useCallback(
    (node: BoxRenderable | null) => {
      rootRef.current = node;
      assignRef(ref, node);
      return () => {
        if (rootRef.current === node) {
          rootRef.current = null;
        }
        assignRef(ref, null);
      };
    },
    [ref],
  );

  const setTrigger = useCallback((value: string, trigger: Renderable | null) => {
    if (trigger) {
      triggers.current.set(value, trigger);
    } else {
      triggers.current.delete(value);
    }
  }, []);

  const getFocusableItems = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return [];
    }
    const registered = new Set(triggers.current.values());
    return getFocusableRenderables(root).filter((node) => registered.has(node));
  }, []);

  const focusRelative = useCallback(
    (value: string, direction: 1 | -1) => {
      const focusableItems = getFocusableItems();

      if (focusableItems.length === 0) {
        return;
      }

      const current = triggers.current.get(value);
      const currentIndex = current ? focusableItems.indexOf(current) : -1;
      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : focusableItems.length - 1
          : (currentIndex + direction + focusableItems.length) % focusableItems.length;
      focusRenderable(renderer, focusableItems[nextIndex]!);
    },
    [getFocusableItems, renderer],
  );

  const focusNext = useCallback(
    (value: string) => {
      focusRelative(value, 1);
    },
    [focusRelative],
  );

  const focusPrevious = useCallback(
    (value: string) => {
      focusRelative(value, -1);
    },
    [focusRelative],
  );

  const focusFirst = useCallback(() => {
    const target = getFocusableItems()[0];
    if (target) {
      focusRenderable(renderer, target);
    }
  }, [getFocusableItems, renderer]);

  const focusLast = useCallback(() => {
    const target = getFocusableItems().at(-1);
    if (target) {
      focusRenderable(renderer, target);
    }
  }, [getFocusableItems, renderer]);

  const isOpen = useCallback((value: string) => openValues.has(value), [openValues]);

  const toggle = useCallback(
    (value: string) => {
      setItemOpen(value);
    },
    [setItemOpen],
  );

  const context = useMemo<AccordionContextValue>(
    () => ({
      canChange,
      isOpen,
      setOpen: setItemOpen,
      toggle,

      setTrigger,

      focusNext,
      focusPrevious,
      focusFirst,
      focusLast,
    }),
    [
      canChange,
      isOpen,
      setItemOpen,
      toggle,
      setTrigger,
      focusNext,
      focusPrevious,
      focusFirst,
      focusLast,
    ],
  );

  return (
    <AccordionContext.Provider value={context}>
      <Stack gap={0} {...props} ref={setRootRef}>
        {children}
      </Stack>
    </AccordionContext.Provider>
  );
}

function AccordionSingleRoot(props: AccordionSingleProps) {
  const controlled = Object.prototype.hasOwnProperty.call(props, "value");

  const { value, defaultValue, onValueChange, multiple: _multiple, ...stackProps } = props;

  const [internalValue, setInternalValue] = useState<string | undefined>(defaultValue);

  const currentValue = controlled ? value : internalValue;
  // Native input can deliver several transitions before React commits.
  const currentValueRef = useRef(currentValue);
  currentValueRef.current = currentValue;

  const setItemOpen = useCallback(
    (itemValue: string, open?: boolean) => {
      const currentValue = currentValueRef.current;
      const nextOpen = open ?? currentValue !== itemValue;
      let nextValue = currentValue;

      if (nextOpen) {
        nextValue = itemValue;
      } else if (currentValue === itemValue) {
        nextValue = undefined;
      }

      if (nextValue === currentValue) {
        return;
      }

      if (!controlled) {
        currentValueRef.current = nextValue;
        setInternalValue(nextValue);
      }

      onValueChange?.(nextValue);
    },
    [controlled, onValueChange],
  );

  const openValues = useMemo(
    () => (currentValue !== undefined ? new Set([currentValue]) : new Set<string>()),
    [currentValue],
  );

  return (
    <AccordionRoot
      canChange={!controlled || onValueChange !== undefined}
      openValues={openValues}
      setItemOpen={setItemOpen}
      {...stackProps}
    />
  );
}

function AccordionMultipleRoot(props: AccordionMultipleProps) {
  const controlled = Object.prototype.hasOwnProperty.call(props, "value");

  const { value, defaultValue = [], onValueChange, multiple: _multiple, ...stackProps } = props;

  const [internalValue, setInternalValue] = useState<string[]>(defaultValue);

  const currentValue = controlled ? (value ?? []) : internalValue;
  // Native input can deliver several transitions before React commits.
  const currentValueRef = useRef(currentValue);
  currentValueRef.current = currentValue;

  const setItemOpen = useCallback(
    (itemValue: string, open?: boolean) => {
      const currentValue = currentValueRef.current;
      const currentlyOpen = currentValue.includes(itemValue);
      const nextOpen = open ?? !currentlyOpen;

      if (currentlyOpen === nextOpen) {
        return;
      }

      const nextValue = nextOpen
        ? [...currentValue, itemValue]
        : currentValue.filter((value) => value !== itemValue);

      if (!controlled) {
        currentValueRef.current = nextValue;
        setInternalValue(nextValue);
      }

      onValueChange?.(nextValue);
    },
    [controlled, onValueChange],
  );

  const openValues = useMemo(() => new Set(currentValue), [currentValue]);

  return (
    <AccordionRoot
      canChange={!controlled || onValueChange !== undefined}
      openValues={openValues}
      setItemOpen={setItemOpen}
      {...stackProps}
    />
  );
}

export function Accordion(props: AccordionProps) {
  if (props.multiple) {
    return <AccordionMultipleRoot {...props} />;
  }

  return <AccordionSingleRoot {...props} />;
}

export interface AccordionItemProps extends StackProps {
  /** Item values must be unique within their accordion. */
  value: string;
  disabled?: boolean;
}

export function AccordionItem({ value, disabled = false, children, ...props }: AccordionItemProps) {
  const { isOpen } = useAccordion();

  const context = useMemo<AccordionItemContextValue>(
    () => ({
      value,
      open: isOpen(value),
      disabled,
    }),
    [disabled, isOpen, value],
  );

  return (
    <AccordionItemContext.Provider value={context}>
      <Stack gap={0} {...props}>
        {children}
      </Stack>
    </AccordionItemContext.Provider>
  );
}

export interface AccordionTriggerProps extends Omit<HStackProps, "focusable"> {}

function isWithinHeader(header: BoxRenderable, event: MouseEvent): boolean {
  return (
    event.x >= header.screenX &&
    event.x < header.screenX + header.width &&
    event.y >= header.screenY &&
    event.y < header.screenY + header.height
  );
}

export function AccordionTrigger({
  children,
  ref,
  bg,
  focused: requestedFocus,
  width = "100%",
  paddingX = 1,
  gap = 1,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseOut,
  ...props
}: AccordionTriggerProps) {
  const accordion = useAccordion();
  const { value, open, disabled } = useAccordionItem();

  const triggerRef = useRef<BoxRenderable | null>(null);
  const mousePressedRef = useRef(false);
  const nativeFocus = useNativeFocus();
  const focused = nativeFocus !== null && nativeFocus === triggerRef.current;
  useControlHints(
    triggerRef,
    disabled
      ? []
      : [
          { keys: "↓/j", label: "Next" },
          { keys: "↑/k", label: "Previous" },
          { keys: "Home/g", label: "First" },
          { keys: "End/G", label: "Last" },
          ...(accordion.canChange
            ? [
                { keys: "Enter/Space", label: open ? "Collapse" : "Expand" },
                open ? { keys: "←/h", label: "Collapse" } : { keys: "→/l", label: "Expand" },
              ]
            : []),
        ],
  );

  const setTriggerRef = useCallback(
    (node: BoxRenderable | null) => {
      triggerRef.current = node;
      accordion.setTrigger(value, node);
      assignRef(ref, node);
      return () => {
        if (triggerRef.current === node) {
          triggerRef.current = null;
          accordion.setTrigger(value, null);
        }
        assignRef(ref, null);
      };
    },
    [accordion.setTrigger, ref, value],
  );

  useLayoutEffect(() => {
    if (disabled) {
      mousePressedRef.current = false;
    }
    setDisabled(triggerRef.current, disabled);
  }, [disabled]);

  function handleKeyDown(key: KeyEvent) {
    onKeyDown?.(key);

    if (disabled || key.defaultPrevented || key.propagationStopped) {
      return;
    }

    const hasNonShiftModifier = key.ctrl || key.meta || key.option || key.super || key.hyper;

    if (hasNonShiftModifier) {
      return;
    }

    let handled = true;

    if (key.name === "g" && key.shift) {
      accordion.focusLast();
    } else if (key.shift) {
      handled = false;
    } else {
      switch (key.name) {
        case "down":
        case "j":
          accordion.focusNext(value);
          break;

        case "up":
        case "k":
          accordion.focusPrevious(value);
          break;

        case "home":
        case "g":
          accordion.focusFirst();
          break;

        case "end":
          accordion.focusLast();
          break;

        case "right":
        case "l":
          if (!accordion.canChange) {
            return;
          }
          accordion.setOpen(value, true);
          break;

        case "left":
        case "h":
          if (!accordion.canChange) {
            return;
          }
          accordion.setOpen(value, false);
          break;

        case "return":
        case "enter":
        case "linefeed":
        case "space":
          if (!accordion.canChange || key.repeated) {
            return;
          }
          accordion.toggle(value);
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

  function handleMouseDown(this: BoxRenderable, event: MouseEvent) {
    mousePressedRef.current = false;
    onMouseDown?.call(this, event);

    if (
      disabled ||
      !accordion.canChange ||
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
      !accordion.canChange ||
      event.defaultPrevented ||
      event.propagationStopped ||
      !wasPressed ||
      !isWithinHeader(this, event) ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }
    accordion.toggle(value);
  }

  function handleMouseOut(this: BoxRenderable, event: MouseEvent) {
    // Native mouse-out also fires when crossing the header's child hit targets.
    if (!isWithinHeader(this, event)) {
      mousePressedRef.current = false;
    }
    onMouseOut?.call(this, event);
  }

  const foreground = disabled ? "mutedForeground" : focused ? "focusForeground" : "foreground";

  return (
    <HStack
      {...props}
      ref={setTriggerRef}
      focusable={!disabled}
      focused={disabled ? false : requestedFocus}
      width={width}
      paddingX={paddingX}
      gap={gap}
      bg={focused && !disabled ? "focus" : bg}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Text fg={foreground}>{open ? symbols.triangleDownFilled : symbols.triangleRightFilled}</Text>

      {isTextContent(children) ? <Text fg={foreground}>{children}</Text> : children}
    </HStack>
  );
}

export interface AccordionContentProps extends Omit<StackProps, "visible"> {}

/** Keeps child state mounted; the surrounding focus scope skips hidden descendants. */
export function AccordionContent({ paddingLeft = 3, ...props }: AccordionContentProps) {
  const { open } = useAccordionItem();

  return <Stack paddingLeft={paddingLeft} marginY={1} {...props} visible={open} />;
}
