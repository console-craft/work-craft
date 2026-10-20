import { type BoxRenderable, type KeyEvent, MouseButton, type MouseEvent } from "@opentui/core";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { symbols } from "@/ui/icons/symbols";
import { useControlHints } from "@/ui/interaction/control-hints";
import { useNativeFocus } from "@/ui/interaction/focus-manager";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { assignRef, isTextContent } from "@/ui/utils";

interface CollapsibleContextValue {
  open: boolean;
  canChange: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

function useCollapsible() {
  const context = useContext(CollapsibleContext);

  if (!context) {
    throw new Error("Collapsible components must be used within <Collapsible>");
  }

  return context;
}

export interface CollapsibleProps extends StackProps {
  /** Controlled state is read-only when onOpenChange is absent. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);

  const open = controlledOpen ?? uncontrolledOpen;
  const canChange = controlledOpen === undefined || onOpenChange !== undefined;
  // Native input can deliver several transitions before React commits.
  const openRef = useRef(open);
  openRef.current = open;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen === openRef.current) {
        return;
      }

      if (controlledOpen === undefined) {
        openRef.current = nextOpen;
        setUncontrolledOpen(nextOpen);
      }

      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  const toggle = useCallback(() => {
    setOpen(!openRef.current);
  }, [setOpen]);

  const context = useMemo(
    () => ({
      open,
      canChange,
      setOpen,
      toggle,
    }),
    [open, canChange, setOpen, toggle],
  );

  return (
    <CollapsibleContext.Provider value={context}>
      <Stack {...props} />
    </CollapsibleContext.Provider>
  );
}

export interface CollapsibleTriggerProps extends Omit<HStackProps, "focusable"> {}

function isWithinHeader(header: BoxRenderable, event: MouseEvent): boolean {
  return (
    event.x >= header.screenX &&
    event.x < header.screenX + header.width &&
    event.y >= header.screenY &&
    event.y < header.screenY + header.height
  );
}

export function CollapsibleTrigger({
  children,
  ref,
  bg,
  width = "100%",
  paddingX = 1,
  gap = 1,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseOut,
  ...props
}: CollapsibleTriggerProps) {
  const { open, canChange, setOpen, toggle } = useCollapsible();

  const triggerRef = useRef<BoxRenderable | null>(null);
  const mousePressedRef = useRef(false);
  const nativeFocus = useNativeFocus();
  const focused = nativeFocus !== null && nativeFocus === triggerRef.current;
  useControlHints(
    triggerRef,
    canChange
      ? [
          { keys: "Enter/Space", label: open ? "Collapse" : "Expand" },
          open ? { keys: "←/h", label: "Collapse" } : { keys: "→/l", label: "Expand" },
        ]
      : [],
  );

  const setTriggerRef = useCallback(
    (node: BoxRenderable | null) => {
      triggerRef.current = node;
      assignRef(ref, node);
      return () => {
        if (triggerRef.current === node) {
          triggerRef.current = null;
        }
        assignRef(ref, null);
      };
    },
    [ref],
  );

  function handleKeyDown(key: KeyEvent) {
    onKeyDown?.(key);

    if (key.defaultPrevented || key.propagationStopped || key.repeated || !canChange) {
      return;
    }

    const hasModifier = key.ctrl || key.meta || key.shift || key.option || key.super || key.hyper;

    if (hasModifier) {
      return;
    }

    let handled = true;

    switch (key.name) {
      case "return":
      case "linefeed":
      case "space":
        toggle();
        break;

      case "right":
      case "l":
        setOpen(true);
        break;

      case "left":
      case "h":
        setOpen(false);
        break;

      default:
        handled = false;
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
      event.defaultPrevented ||
      event.propagationStopped ||
      !canChange ||
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
      event.defaultPrevented ||
      event.propagationStopped ||
      !canChange ||
      !wasPressed ||
      !isWithinHeader(this, event) ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }
    toggle();
  }

  function handleMouseOut(this: BoxRenderable, event: MouseEvent) {
    // Native mouse-out also fires when crossing the header's child hit targets.
    if (!isWithinHeader(this, event)) {
      mousePressedRef.current = false;
    }
    onMouseOut?.call(this, event);
  }

  const foreground = focused ? "focusForeground" : "foreground";

  return (
    <HStack
      {...props}
      ref={setTriggerRef}
      focusable
      width={width}
      paddingX={paddingX}
      gap={gap}
      bg={focused ? "focus" : bg}
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

export interface CollapsibleContentProps extends Omit<StackProps, "visible"> {}

/** Keeps child state mounted; the surrounding focus scope skips hidden descendants. */
export function CollapsibleContent(props: CollapsibleContentProps) {
  const { open } = useCollapsible();

  return <Stack {...props} visible={open} />;
}
