import {
  type BoxRenderable,
  CliRenderEvents,
  type KeyEvent,
  MouseButton,
  type MouseEvent,
  RenderableEvents,
} from "@opentui/core";
import { createPortal, useRenderer } from "@opentui/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button, type ButtonProps } from "@/ui/controls/button";
import { isVisible } from "@/ui/interaction/focus-utils";
import { Box, type BoxProps } from "@/ui/primitives/box";
import { Divider, type DividerProps } from "@/ui/primitives/divider";
import { Text } from "@/ui/primitives/text";
import { assignRef, isTextContent } from "@/ui/utils";

type MenuItemRegistration = {
  id: string;
  disabled: boolean;
  node: BoxRenderable | null;
  onSelect?: () => void;
};

type MenuContextValue = {
  open: boolean;
  activeId: string | null;
  canChange: boolean;

  triggerRef: {
    current: BoxRenderable | null;
  };

  openMenu: () => void;
  closeMenu: () => void;

  registerItem: (item: MenuItemRegistration) => () => void;

  setActive: (id: string) => void;
  moveActive: (direction: 1 | -1) => void;
  focusFirst: () => void;
  focusLast: () => void;

  selectActive: () => void;
  canSelectActive: () => boolean;
  selectItem: (id: string) => void;
};

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenu(component: string) {
  const context = useContext(MenuContext);

  if (!context) {
    throw new Error(`${component} must be used within <Menu>`);
  }

  return context;
}

function hasCommandModifier(event: KeyEvent) {
  return event.ctrl || event.meta || event.option || event.super || event.hyper;
}

function isActivationKey(event: KeyEvent) {
  return event.name === "return" || event.name === "linefeed" || event.name === "space";
}

function isWithinRow(node: BoxRenderable, event: MouseEvent): boolean {
  return (
    event.x >= node.screenX &&
    event.x < node.screenX + node.width &&
    event.y >= node.screenY &&
    event.y < node.screenY + node.height
  );
}

function isEnabledItem(
  item: MenuItemRegistration | undefined,
): item is MenuItemRegistration & { node: BoxRenderable } {
  return item !== undefined && !item.disabled && item.node !== null && isVisible(item.node);
}

export interface MenuProps {
  children: ReactNode;

  /** Controlled state is read-only when onOpenChange is absent. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Menu({ children, open, defaultOpen = false, onOpenChange }: MenuProps) {
  const controlled = open !== undefined;
  const canChange = !controlled || onOpenChange !== undefined;

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);

  // Native input may navigate and activate before React commits the highlight.
  const updateActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const currentOpen = open ?? internalOpen;

  const currentOpenRef = useRef(currentOpen);
  const controlledRef = useRef(controlled);
  const onOpenChangeRef = useRef(onOpenChange);

  currentOpenRef.current = currentOpen;
  controlledRef.current = controlled;
  onOpenChangeRef.current = onOpenChange;

  const triggerRef = useRef<BoxRenderable | null>(null);
  const itemsRef = useRef(new Map<string, MenuItemRegistration>());

  const setOpen = useCallback((nextOpen: boolean) => {
    if (nextOpen === currentOpenRef.current) {
      return;
    }

    if (!controlledRef.current) {
      currentOpenRef.current = nextOpen;
      setInternalOpen(nextOpen);
    }

    onOpenChangeRef.current?.(nextOpen);
  }, []);

  const getEnabledItems = useCallback(() => {
    return [...itemsRef.current.values()].filter(isEnabledItem).sort((a, b) => {
      const aNode = a.node;
      const bNode = b.node;

      return (
        aNode.screenY - bNode.screenY || aNode.screenX - bNode.screenX || aNode.num - bNode.num
      );
    });
  }, []);

  const ensureActive = useCallback(() => {
    const items = getEnabledItems();
    const current = activeIdRef.current;

    if (current && items.some((item) => item.id === current)) {
      return;
    }

    updateActive(items[0]?.id ?? null);
  }, [getEnabledItems, updateActive]);

  const registerItem = useCallback(
    (item: MenuItemRegistration) => {
      itemsRef.current.set(item.id, item);

      queueMicrotask(() => {
        if (currentOpenRef.current) {
          ensureActive();
        }
      });

      return () => {
        if (itemsRef.current.get(item.id) === item) {
          itemsRef.current.delete(item.id);
        }

        queueMicrotask(() => {
          if (currentOpenRef.current) {
            ensureActive();
          }
        });
      };
    },
    [ensureActive],
  );

  const openMenu = useCallback(() => {
    setOpen(true);

    queueMicrotask(() => {
      if (currentOpenRef.current) {
        ensureActive();
      }
    });
  }, [ensureActive, setOpen]);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const setActive = useCallback(
    (id: string) => {
      const item = itemsRef.current.get(id);

      if (!isEnabledItem(item)) {
        return;
      }

      updateActive(id);
    },
    [updateActive],
  );

  const focusFirst = useCallback(() => {
    updateActive(getEnabledItems()[0]?.id ?? null);
  }, [getEnabledItems, updateActive]);

  const focusLast = useCallback(() => {
    updateActive(getEnabledItems().at(-1)?.id ?? null);
  }, [getEnabledItems, updateActive]);

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      const items = getEnabledItems();

      if (items.length === 0) {
        updateActive(null);
        return;
      }

      const currentIndex = items.findIndex((item) => item.id === activeIdRef.current);
      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : items.length - 1
          : (currentIndex + direction + items.length) % items.length;

      updateActive(items[nextIndex]!.id);
    },
    [getEnabledItems, updateActive],
  );

  const selectItem = useCallback(
    (id: string) => {
      const item = itemsRef.current.get(id);

      if (!isEnabledItem(item)) {
        return;
      }

      setOpen(false);
      item.onSelect?.();
    },
    [setOpen],
  );

  const canSelectActive = useCallback(() => {
    const id = activeIdRef.current;
    return id !== null && isEnabledItem(itemsRef.current.get(id));
  }, []);

  const selectActive = useCallback(() => {
    if (activeIdRef.current) {
      selectItem(activeIdRef.current);
    }
  }, [selectItem]);

  useLayoutEffect(() => {
    if (!currentOpen) {
      updateActive(null);
    }
  }, [currentOpen, updateActive]);

  const context = useMemo<MenuContextValue>(
    () => ({
      open: currentOpen,
      activeId,
      canChange,

      triggerRef,

      openMenu,
      closeMenu,

      registerItem,

      setActive,
      moveActive,
      focusFirst,
      focusLast,

      selectActive,
      canSelectActive,
      selectItem,
    }),
    [
      currentOpen,
      activeId,
      canChange,
      openMenu,
      closeMenu,
      registerItem,
      setActive,
      moveActive,
      focusFirst,
      focusLast,
      selectActive,
      canSelectActive,
      selectItem,
    ],
  );

  return <MenuContext.Provider value={context}>{children}</MenuContext.Provider>;
}

export interface MenuTriggerProps extends ButtonProps {}

export function MenuTrigger({
  ref,
  disabled = false,

  onPress,
  onKeyDown,

  ...props
}: MenuTriggerProps) {
  const menu = useMenu("MenuTrigger");
  const controlHints = () =>
    menu.open
      ? [
          { keys: "↑/↓/j/k", label: "Navigate" },
          { keys: "g/G", label: "First/last" },
          ...(menu.canSelectActive() ? [{ keys: "Enter/Space", label: "Select" }] : []),
          ...(menu.canChange ? [{ keys: "Escape", label: "Close menu" }] : []),
          { keys: "Tab/Shift+Tab", label: "Next/previous control" },
        ]
      : menu.canChange
        ? [{ keys: "Enter/Space/↓", label: "Open menu" }]
        : [];

  const setTriggerRef = useCallback(
    (node: BoxRenderable | null) => {
      menu.triggerRef.current = node;
      assignRef(ref, node);

      if (!node) {
        return;
      }

      const handleBlur = () => {
        menu.closeMenu();
      };

      node.on(RenderableEvents.BLURRED, handleBlur);

      return () => {
        node.off(RenderableEvents.BLURRED, handleBlur);

        if (menu.triggerRef.current === node) {
          menu.triggerRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref, menu.closeMenu, menu.triggerRef],
  );

  function handlePress() {
    onPress?.();

    if (menu.open) {
      menu.closeMenu();
    } else {
      menu.openMenu();
    }
  }

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    if (!menu.open) {
      if (!hasCommandModifier(event) && event.name === "down") {
        event.preventDefault();
        event.stopPropagation();

        menu.openMenu();
      }

      return;
    }

    if (event.name === "escape") {
      event.preventDefault();
      event.stopPropagation();

      menu.closeMenu();
      return;
    }

    // Don't consume Tab. FocusManager performs normal traversal;
    // the trigger's BLURRED event closes the menu.
    if (event.name === "tab") {
      return;
    }

    if (hasCommandModifier(event)) {
      return;
    }

    if (event.name === "down" || event.name === "j") {
      event.preventDefault();
      event.stopPropagation();

      menu.moveActive(1);
      return;
    }

    if (event.name === "up" || event.name === "k") {
      event.preventDefault();
      event.stopPropagation();

      menu.moveActive(-1);
      return;
    }

    if (event.name === "g") {
      event.preventDefault();
      event.stopPropagation();

      if (event.shift) {
        menu.focusLast();
      } else {
        menu.focusFirst();
      }

      return;
    }

    if (isActivationKey(event)) {
      event.preventDefault();
      event.stopPropagation();

      if (!event.repeated) {
        menu.selectActive();
      }
    }
  }

  return (
    <Button
      controlHints={controlHints}
      {...props}
      ref={setTriggerRef}
      disabled={disabled}
      onPress={handlePress}
      onKeyDown={handleKeyDown}
    />
  );
}

type MenuPosition = {
  left: number;
  top: number;
  triggerWidth: number;
};

type MenuSide = "auto" | "top" | "bottom";

export interface MenuContentProps extends Omit<
  BoxProps,
  "position" | "top" | "right" | "bottom" | "left" | "focusable"
> {
  side?: MenuSide;
}

export function MenuContent({
  ref,
  children,

  bg = "background",
  border = true,
  flexDirection = "column",
  side = "auto",

  minWidth,

  onMouseDown,
  onSizeChange,

  ...props
}: MenuContentProps) {
  const renderer = useRenderer();
  const menu = useMenu("MenuContent");

  const contentRef = useRef<BoxRenderable | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const updatePosition = useCallback(
    (content = contentRef.current) => {
      const trigger = menu.triggerRef.current;

      if (!trigger || !content || content.isDestroyed) {
        return;
      }

      const root = renderer.root;

      const triggerLeft = trigger.screenX - root.screenX;

      const triggerTop = trigger.screenY - root.screenY;

      const below = triggerTop + trigger.height;

      const above = triggerTop - content.height;

      const maxLeft = Math.max(0, root.width - content.width);

      const left = Math.max(0, Math.min(triggerLeft, maxLeft));

      const fitsBelow = below + content.height <= root.height;

      const top =
        side === "bottom"
          ? below
          : side === "top"
            ? Math.max(0, above)
            : fitsBelow
              ? below
              : Math.max(0, above);

      const next: MenuPosition = {
        left,
        top,
        triggerWidth: trigger.width,
      };

      setPosition((current) => {
        if (
          current?.left === next.left &&
          current.top === next.top &&
          current.triggerWidth === next.triggerWidth
        ) {
          return current;
        }

        return next;
      });
    },
    [menu.triggerRef, renderer, side],
  );

  const setContentRef = useCallback(
    (node: BoxRenderable | null) => {
      contentRef.current = node;
      assignRef(ref, node);

      if (!node) {
        return;
      }

      queueMicrotask(() => {
        updatePosition(node);
      });

      return () => {
        if (contentRef.current === node) {
          contentRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref, updatePosition],
  );

  useLayoutEffect(() => {
    if (!menu.open) {
      setPosition(null);
      return;
    }

    function handleFrame() {
      updatePosition();
    }

    renderer.on(CliRenderEvents.FRAME, handleFrame);

    queueMicrotask(handleFrame);

    return () => {
      renderer.off(CliRenderEvents.FRAME, handleFrame);
    };
  }, [menu.open, renderer, updatePosition]);

  function handleBackdropMouseDown(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.button === MouseButton.LEFT) {
      menu.closeMenu();
    }
  }

  function handleContentMouseDown(this: BoxRenderable, event: MouseEvent) {
    onMouseDown?.call(this, event);

    // Keep clicks inside the surface from reaching
    // the full-screen dismissal layer.
    event.stopPropagation();
  }

  function handleSizeChange(this: BoxRenderable) {
    onSizeChange?.call(this);
    updatePosition(this);
  }

  if (!menu.open) {
    return null;
  }

  const trigger = menu.triggerRef.current;

  const fallbackLeft = trigger ? trigger.screenX - renderer.root.screenX : 0;

  const fallbackTop = trigger ? trigger.screenY - renderer.root.screenY + trigger.height : 0;

  return createPortal(
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={1100}
      onMouseDown={handleBackdropMouseDown}
    >
      <Box
        {...props}
        ref={setContentRef}
        position="absolute"
        left={position?.left ?? fallbackLeft}
        top={position?.top ?? fallbackTop}
        minWidth={minWidth ?? position?.triggerWidth ?? trigger?.width}
        bg={bg}
        border={border}
        flexDirection={flexDirection}
        onMouseDown={handleContentMouseDown}
        onSizeChange={handleSizeChange}
      >
        {children}
      </Box>
    </Box>,
    renderer.root,
    null,
  );
}

export interface MenuItemProps extends Omit<BoxProps, "focusable"> {
  disabled?: boolean;
  onSelect?: () => void;
}

export function MenuItem({
  ref,
  children,

  disabled = false,
  onSelect,

  bg,
  paddingX = 1,
  alignSelf = "stretch",

  onMouseDown,
  onMouseUp,
  onMouseOver,
  onMouseOut,
  onMouseDrag,

  ...props
}: MenuItemProps) {
  const renderer = useRenderer();
  const menu = useMenu("MenuItem");

  const reactId = useId();
  const id = `menu-item-${reactId.replaceAll(":", "")}`;

  const nodeRef = useRef<BoxRenderable | null>(null);
  const mousePressedRef = useRef(false);

  const active = menu.activeId === id;

  const setItemRef = useCallback(
    (node: BoxRenderable | null) => {
      nodeRef.current = node;
      assignRef(ref, node);

      return () => {
        if (nodeRef.current === node) {
          nodeRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    return menu.registerItem({
      id,
      disabled,
      node: nodeRef.current,
      onSelect,
    });
  }, [id, disabled, onSelect, menu.registerItem]);

  function handleMouseOver(this: BoxRenderable, event: MouseEvent) {
    onMouseOver?.call(this, event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    menu.setActive(id);
  }

  function handleMouseDown(this: BoxRenderable, event: MouseEvent) {
    onMouseDown?.call(this, event);

    if (event.defaultPrevented || disabled || event.button !== MouseButton.LEFT) {
      return;
    }

    // Native text selection starts before row dispatch and would intercept subsequent drags.
    renderer.clearSelection();
    mousePressedRef.current = true;
    menu.setActive(id);
  }

  function handleMouseUp(this: BoxRenderable, event: MouseEvent) {
    const wasPressed = mousePressedRef.current;
    mousePressedRef.current = false;

    onMouseUp?.call(this, event);

    if (
      event.defaultPrevented ||
      disabled ||
      !wasPressed ||
      event.button !== MouseButton.LEFT ||
      !isWithinRow(this, event)
    ) {
      return;
    }

    menu.selectItem(id);
  }

  function handleMouseOut(this: BoxRenderable, event: MouseEvent) {
    if (!isWithinRow(this, event)) {
      mousePressedRef.current = false;
    }
    onMouseOut?.call(this, event);
  }

  function handleMouseDrag(this: BoxRenderable, event: MouseEvent) {
    // Captured child targets may not emit mouse-out when a drag leaves the row.
    if (!isWithinRow(this, event)) {
      mousePressedRef.current = false;
    }
    onMouseDrag?.call(this, event);
  }

  const fg = disabled ? "mutedForeground" : active ? "focusForeground" : "foreground";

  return (
    <Box
      {...props}
      ref={setItemRef}
      focusable={false}
      alignSelf={alignSelf}
      paddingX={paddingX}
      bg={active ? "focus" : bg}
      onMouseOver={handleMouseOver}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
      onMouseDrag={handleMouseDrag}
    >
      {isTextContent(children) ? <Text fg={fg}>{children}</Text> : children}
    </Box>
  );
}

export interface MenuSeparatorProps extends Omit<DividerProps, "orientation"> {}

export function MenuSeparator(props: MenuSeparatorProps) {
  return <Divider orientation="horizontal" {...props} />;
}
