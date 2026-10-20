import {
  type BoxRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent,
  type Renderable,
  RenderableEvents,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import {
  createContext,
  type Ref,
  useCallback,
  useContext,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type ListItemRecord, useListCursor } from "@/ui/components/list-cursor";
import { useListReveal } from "@/ui/components/list-reveal";
import { cyclicIndex, pageIndex, renderedOrder } from "@/ui/interaction/collection";
import { type ControlHintSource, useControlHints } from "@/ui/interaction/control-hints";
import { useNativeFocus } from "@/ui/interaction/focus-manager";
import { focusRenderable, isEligibleFocusTarget, isVisible } from "@/ui/interaction/focus-utils";
import { consumePrimaryPointerPress, usePointerObservation } from "@/ui/interaction/pointer";
import { Box, type BoxProps } from "@/ui/primitives/box";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Text } from "@/ui/primitives/text";
import { assignRef, isTextContent, setDisabled } from "@/ui/utils";

type ListContextValue = {
  value: string | undefined;
  activeValue: string | undefined;
  focused: boolean;
  disabled: boolean;
  register: (item: ListItemRecord) => () => void;
  activate: (value: string) => void;
  beginPress: (node: BoxRenderable, event: MouseEvent) => void;
  endPress: (node: BoxRenderable, event?: MouseEvent) => boolean;
};

const ListContext = createContext<ListContextValue | null>(null);

function useList(): ListContextValue {
  const context = useContext(ListContext);
  if (!context) {
    throw new Error("ListItem must be used within <List>");
  }
  return context;
}

export type ListCursorHandle = {
  /** Focus an eligible current cursor without selecting; controlled requests must be acknowledged. */
  focusValue(value: string): boolean;
};

export interface ListProps extends Omit<BoxProps, "focusable"> {
  /** Disables focus and row interaction; wheel scrolling remains available. */
  disabled?: boolean;
  horizontalScrolling?: boolean;
  /** Passing value, including undefined, selects controlled state. */
  value?: string;
  defaultValue?: string;
  /** Controlled selection is read-only without this callback. */
  onValueChange?: (value: string) => void;
  /** Independent virtual cursor. Passing this prop, including undefined, selects controlled state. */
  activeValue?: string;
  defaultActiveValue?: string;
  /** Separate from the native Box ref; only moves the browsing cursor and List focus. */
  cursorRef?: Ref<ListCursorHandle>;
  /** Replaces the default hints; an empty array or empty getter result suppresses them. */
  controlHints?: ControlHintSource;
  /** Controlled cursor is read-only without this callback; undefined means no eligible cursor remains. */
  onActiveValueChange?: (value: string | undefined) => void;
  /** Every deliberate activation fires, including for an already selected item. */
  onActivate?: (value: string) => void;
}

/** One native focus endpoint; rich rows must not contain focusable controls. */
export function List(props: ListProps) {
  const renderer = useRenderer();
  usePointerObservation();
  const controlledValue = Object.prototype.hasOwnProperty.call(props, "value");
  const controlledActive = Object.prototype.hasOwnProperty.call(props, "activeValue");
  const {
    ref,
    children,
    disabled = false,
    horizontalScrolling = false,
    focused: requestedFocus,
    bg,
    value,
    defaultValue,
    onValueChange,
    activeValue,
    defaultActiveValue,
    cursorRef,
    controlHints,
    onActiveValueChange,
    onActivate,
    onKeyDown,
    flexDirection = "column",
    ...boxProps
  } = props;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const rootRef = useRef<BoxRenderable | null>(null);
  const areaRef = useRef<ScrollBoxRenderable | null>(null);
  const pressedRow = useRef<{ node: BoxRenderable; press: number } | null>(null);
  const nativeFocus = useNativeFocus();
  const focused = !disabled && nativeFocus !== null && nativeFocus === rootRef.current;
  const items = useRef(new Map<string, ListItemRecord>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    setDisabled(rootRef.current, disabled);
    if (disabled) {
      pressedRow.current = null;
    }
  }, [disabled]);

  const register = useCallback((item: ListItemRecord) => {
    items.current.set(item.id, item);
    setRegistryVersion((version) => version + 1);
    return () => {
      if (items.current.get(item.id) === item) {
        items.current.delete(item.id);
        if (mounted.current) {
          setRegistryVersion((version) => version + 1);
        }
      }
    };
  }, []);

  const getItems = useCallback((): ListItemRecord[] => {
    if (disabledRef.current) {
      return [];
    }
    const candidates = new Map<Renderable, ListItemRecord>();
    for (const item of items.current.values()) {
      if (!item.disabled && isVisible(item.node)) {
        candidates.set(item.node, item);
      }
    }
    return renderedOrder(areaRef.current?.content ?? null, candidates);
  }, []);

  const cursor = useListCursor({
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
    root: () => rootRef.current,
  });
  const {
    value: currentValue,
    activeValue: currentActive,
    changeActive,
    repair: repairActive,
    activate,
  } = cursor;

  const setRootRef = useCallback(
    (node: BoxRenderable | null) => {
      rootRef.current = node;
      assignRef(ref, node);
      node?.on(RenderableEvents.FOCUSED, repairActive);
      return () => {
        node?.off(RenderableEvents.FOCUSED, repairActive);
        if (rootRef.current === node) {
          rootRef.current = null;
        }
        assignRef(ref, null);
      };
    },
    [ref, repairActive],
  );

  useImperativeHandle(
    cursorRef,
    () => ({
      focusValue(value: string): boolean {
        if (!mounted.current) {
          return false;
        }
        const root = rootRef.current;
        const target = getItems().find((item) => item.value === value);
        if (!root || !target || !isEligibleFocusTarget(root, renderer.root)) {
          return false;
        }
        changeActive(value);
        const isCurrent = (): boolean => {
          return (
            mounted.current &&
            rootRef.current === root &&
            cursor.getActive() === value &&
            isEligibleFocusTarget(root, renderer.root) &&
            getItems().includes(target)
          );
        };
        if (!isCurrent()) {
          return false;
        }
        const previous = renderer.currentFocusedRenderable;
        focusRenderable(renderer, root);
        if (renderer.currentFocusedRenderable === root && isCurrent()) {
          return true;
        }
        if (
          renderer.currentFocusedRenderable === root &&
          previous &&
          previous !== root &&
          isEligibleFocusTarget(previous, renderer.root)
        ) {
          focusRenderable(renderer, previous);
        }
        return false;
      },
    }),
    [renderer, getItems, changeActive],
  );

  useLayoutEffect(() => {
    repairActive();
  }, [
    registryVersion,
    currentActive,
    currentValue,
    focused,
    disabled,
    onActiveValueChange,
    repairActive,
  ]);

  useListReveal({
    renderer,
    repair: repairActive,
    read() {
      const eligible = getItems();
      return {
        root: rootRef.current,
        area: areaRef.current,
        activeNode: eligible.find((item) => item.value === cursor.getActive())?.node ?? null,
        disabled: disabledRef.current,
        pressedNode: eligible.some((item) => item.node === pressedRow.current?.node)
          ? (pressedRow.current?.node ?? null)
          : null,
      };
    },
    releasePress() {
      pressedRow.current = null;
    },
  });

  const beginPress = useCallback(
    (node: BoxRenderable, event: MouseEvent) => {
      const press = consumePrimaryPointerPress(renderer, event);
      if (disabledRef.current || press === undefined) {
        return;
      }
      pressedRow.current = { node, press };
      const root = rootRef.current;
      if (root && isEligibleFocusTarget(root, root)) {
        focusRenderable(renderer, root);
      }
    },
    [renderer],
  );

  const endPress = useCallback(
    (node: BoxRenderable, event?: MouseEvent) => {
      const press = event ? consumePrimaryPointerPress(renderer, event) : pressedRow.current?.press;
      if (pressedRow.current?.node === node) {
        const matching = pressedRow.current.press === press;
        pressedRow.current = null;
        return matching;
      }
      return false;
    },
    [renderer],
  );

  function pageTarget(
    eligible: ListItemRecord[],
    index: number,
    direction: 1 | -1,
    half: boolean,
  ): ListItemRecord | undefined {
    const distance = (areaRef.current?.viewport.height ?? 0) * (half ? 0.5 : 1);
    return eligible[
      pageIndex(
        eligible.map((item) => item.node.screenY),
        index,
        direction,
        distance,
      ) ?? -1
    ];
  }

  function handleKeyDown(key: KeyEvent) {
    onKeyDown?.(key);
    if (
      key.defaultPrevented ||
      disabledRef.current ||
      key.propagationStopped ||
      key.meta ||
      key.option ||
      key.super ||
      key.hyper
    ) {
      return;
    }
    const eligible = getItems();
    const index = eligible.findIndex((item) => item.value === cursor.getActive());
    let next: ListItemRecord | undefined;
    if (key.ctrl && !key.shift && ["d", "u", "f", "b"].includes(key.name)) {
      next = pageTarget(
        eligible,
        index,
        ["d", "f"].includes(key.name) ? 1 : -1,
        ["d", "u"].includes(key.name),
      );
    } else if (key.ctrl && !key.shift && ["n", "p"].includes(key.name)) {
      const direction = key.name === "n" ? 1 : -1;
      next = eligible[cyclicIndex(eligible.length, index, direction) ?? -1];
    } else if (!key.ctrl && key.name === "g") {
      next = key.shift ? eligible.at(-1) : eligible[0];
    } else if (!key.ctrl && !key.shift) {
      switch (key.name) {
        case "down":
        case "j":
          next = eligible[cyclicIndex(eligible.length, index, 1) ?? -1];
          break;
        case "up":
        case "k":
          next = eligible[cyclicIndex(eligible.length, index, -1) ?? -1];
          break;
        case "home":
          next = eligible[0];
          break;
        case "end":
          next = eligible.at(-1);
          break;
        case "pageup":
        case "pagedown":
          next = pageTarget(eligible, index, key.name === "pagedown" ? 1 : -1, false);
          break;
        case "return":
        case "enter":
        case "linefeed":
          if (index < 0) {
            return;
          }
          key.preventDefault();
          key.stopPropagation();
          if (!key.repeated) {
            activate(eligible[index]!.value);
          }
          return;
        default:
          return;
      }
    } else {
      return;
    }
    key.preventDefault();
    key.stopPropagation();
    changeActive(next?.value);
  }

  useControlHints(
    rootRef,
    controlHints === undefined
      ? () =>
          getItems().length > 0
            ? [
                ...(cursor.canNavigate()
                  ? [
                      { keys: "↑/↓/j/k", label: "Navigate" },
                      { keys: "Ctrl+d/u", label: "Half-page" },
                    ]
                  : []),
                ...(getItems().some((item) => item.value === cursor.getActive())
                  ? [{ keys: "Enter", label: "Open" }]
                  : []),
              ]
            : []
      : controlHints,
  );

  const context = useMemo<ListContextValue>(
    () => ({
      value: currentValue,
      activeValue: currentActive,
      focused,
      disabled,
      register,
      activate,
      beginPress,
      endPress,
    }),
    [currentValue, currentActive, focused, disabled, register, activate, beginPress, endPress],
  );

  return (
    <ListContext.Provider value={context}>
      <Box
        {...boxProps}
        ref={setRootRef}
        focusable={!disabled}
        focused={disabled ? false : requestedFocus}
        bg={bg}
        flexDirection={flexDirection}
        onKeyDown={handleKeyDown}
      >
        <ScrollArea
          ref={areaRef}
          flexGrow={1}
          minHeight={0}
          focusable={false}
          keyboardFallback={false}
          scrollX={horizontalScrolling}
        >
          {children}
        </ScrollArea>
      </Box>
    </ListContext.Provider>
  );
}

export interface ListItemProps extends Omit<BoxProps, "focusable" | "focused"> {
  /** Values must be unique within the List; native IDs are independent. */
  value: string;
  disabled?: boolean;
}

export function ListItem({
  value,
  disabled = false,
  ref,
  id,
  children,
  bg,
  paddingX = 1,
  alignSelf = "stretch",
  flexShrink = 0,
  onMouseDown,
  onMouseUp,
  onMouseOut,
  onMouseDrag,
  ...props
}: ListItemProps) {
  const list = useList();
  const isDisabled = disabled || list.disabled;
  const reactId = useId();
  const itemId = `list-item-${reactId.replaceAll(":", "")}`;
  const nodeRef = useRef<BoxRenderable | null>(null);
  const pressed = useRef(false);
  const setItemRef = useCallback(
    (node: BoxRenderable | null) => {
      nodeRef.current = node;
      assignRef(ref, node);
      return () => {
        if (node) {
          list.endPress(node);
        }
        if (nodeRef.current === node) {
          nodeRef.current = null;
        }
        assignRef(ref, null);
      };
    },
    [ref, list.endPress],
  );
  useLayoutEffect(() => {
    if (nodeRef.current) {
      return list.register({ id: itemId, value, disabled, node: nodeRef.current });
    }
  }, [itemId, value, disabled, list.register]);

  useLayoutEffect(() => {
    pressed.current = false;
    if (nodeRef.current) {
      list.endPress(nodeRef.current);
    }
  }, [value, disabled, list.disabled, list.endPress]);

  function isWithinRow(node: BoxRenderable, event: MouseEvent): boolean {
    for (let current: Renderable | null = node; current; current = current.parent) {
      if (current !== node && current.overflow !== "hidden") {
        continue;
      }
      if (
        event.x < current.screenX ||
        event.x >= current.screenX + current.width ||
        event.y < current.screenY ||
        event.y >= current.screenY + current.height
      ) {
        return false;
      }
    }
    return true;
  }

  function handleMouseDown(this: BoxRenderable, event: MouseEvent) {
    pressed.current = false;
    list.endPress(this);
    onMouseDown?.call(this, event);
    if (
      isDisabled ||
      event.defaultPrevented ||
      event.propagationStopped ||
      event.button !== MouseButton.LEFT ||
      !isVisible(this)
    ) {
      return;
    }
    pressed.current = true;
    list.beginPress(this, event);
  }

  function handleMouseUp(this: BoxRenderable, event: MouseEvent) {
    const pending = list.endPress(this, event);
    const wasPressed = pressed.current && pending;
    pressed.current = false;
    onMouseUp?.call(this, event);
    if (
      isDisabled ||
      !wasPressed ||
      event.defaultPrevented ||
      event.propagationStopped ||
      event.button !== MouseButton.LEFT ||
      !isWithinRow(this, event)
    ) {
      return;
    }
    list.activate(value);
  }

  function handleMouseOut(this: BoxRenderable, event: MouseEvent) {
    if (!isWithinRow(this, event)) {
      pressed.current = false;
      list.endPress(this);
    }
    onMouseOut?.call(this, event);
  }

  function handleMouseDrag(this: BoxRenderable, event: MouseEvent) {
    if (!isWithinRow(this, event)) {
      pressed.current = false;
      list.endPress(this);
    }
    onMouseDrag?.call(this, event);
  }

  const active = list.focused && list.activeValue === value;
  const selected = list.value === value;
  const foreground = isDisabled
    ? "mutedForeground"
    : active && selected
      ? "primary"
      : active
        ? "focusForeground"
        : selected
          ? "primaryForeground"
          : "foreground";

  const background = list.disabled
    ? selected
      ? "secondary"
      : bg
    : active
      ? "focus"
      : selected
        ? "primary"
        : bg;
  return (
    <Box
      {...props}
      ref={setItemRef}
      id={id ?? itemId}
      focusable={false}
      alignSelf={alignSelf}
      flexShrink={flexShrink}
      paddingX={paddingX}
      bg={background}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
      onMouseDrag={handleMouseDrag}
    >
      {isTextContent(children) ? <Text fg={foreground}>{children}</Text> : children}
    </Box>
  );
}
