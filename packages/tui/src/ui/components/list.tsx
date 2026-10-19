import {
  type BoxRenderable,
  CliRenderEvents,
  isRenderable,
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

import { type ControlHintSource, useControlHints } from "@/ui/control-hints";
import { useNativeFocus } from "@/ui/focus-manager";
import { focusRenderable, isEligibleFocusTarget, isVisible } from "@/ui/focus-utils";
import { Box, type BoxProps } from "@/ui/primitives/box";
import {
  consumePrimaryPointerPress,
  isPrimaryPointerPressed,
  ScrollArea,
} from "@/ui/primitives/scroll-area";
import { Text } from "@/ui/primitives/text";
import { assignRef, isTextContent, setDisabled } from "@/ui/utils";

type ListItemRecord = {
  id: string;
  value: string;
  disabled: boolean;
  node: BoxRenderable;
};

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
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalActive, setInternalActive] = useState(defaultActiveValue);
  const currentValue = controlledValue ? value : internalValue;
  const currentActive = controlledActive ? activeValue : internalActive;
  const rootRef = useRef<BoxRenderable | null>(null);
  const areaRef = useRef<ScrollBoxRenderable | null>(null);
  const pressedRow = useRef<{ node: BoxRenderable; press: number } | null>(null);
  const nativeFocus = useNativeFocus();
  const focused = !disabled && nativeFocus !== null && nativeFocus === rootRef.current;
  const items = useRef(new Map<string, ListItemRecord>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const mounted = useRef(false);
  const state = useRef({
    value: currentValue,
    active: currentActive,
    controlledValue,
    controlledActive,
    onValueChange,
    onActiveValueChange,
    onActivate,
    disabled,
  });
  state.current = {
    value: currentValue,
    active: currentActive,
    controlledValue,
    controlledActive,
    onValueChange,
    onActiveValueChange,
    onActivate,
    disabled,
  };
  const repairRequest = useRef<{ from: string | undefined; to: string | undefined } | null>(null);

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
      repairRequest.current = null;
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
    if (state.current.disabled) {
      return [];
    }
    const candidates = new Map<Renderable, ListItemRecord>();
    for (const item of items.current.values()) {
      if (!item.disabled && isVisible(item.node)) {
        candidates.set(item.node, item);
      }
    }
    const ordered: ListItemRecord[] = [];
    function visit(node: Renderable) {
      const item = candidates.get(node);
      if (item) {
        ordered.push(item);
      }
      for (const child of node.getChildren()) {
        if (isRenderable(child)) {
          visit(child);
        }
      }
    }
    if (areaRef.current) {
      visit(areaRef.current.content);
    }
    return ordered;
  }, []);

  const changeActive = useCallback((next: string | undefined, repair = false) => {
    const current = state.current;
    if (current.disabled) {
      return;
    }
    if (next === current.active) {
      repairRequest.current = null;
      return;
    }
    if (current.controlledActive) {
      if (!current.onActiveValueChange) {
        repairRequest.current = null;
        return;
      }
      const pending = repairRequest.current;
      if (repair && pending && pending.from === current.active && pending.to === next) {
        return;
      }
      repairRequest.current = repair ? { from: current.active, to: next } : null;
    } else {
      current.active = next;
      setInternalActive(next);
    }
    current.onActiveValueChange?.(next);
  }, []);

  const repairActive = useCallback(() => {
    const root = rootRef.current;
    if (
      state.current.disabled ||
      !root ||
      !isVisible(root) ||
      (state.current.active === undefined && !root.focused)
    ) {
      return;
    }
    const eligible = getItems();
    if (eligible.some((item) => item.value === state.current.active)) {
      repairRequest.current = null;
      return;
    }
    const selected = eligible.find((item) => item.value === state.current.value);
    changeActive(selected?.value ?? eligible[0]?.value, true);
  }, [getItems, changeActive]);

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
            state.current.active === value &&
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

  useLayoutEffect(() => {
    let lastReveal: {
      node: BoxRenderable;
      top: number;
      height: number;
      width: number;
      viewportHeight: number;
      viewportWidth: number;
      focused: boolean;
    } | null = null;
    function reconcile() {
      if (state.current.disabled) {
        lastReveal = null;
        return;
      }
      repairActive();
      if (pressedRow.current) {
        if (
          isPrimaryPointerPressed(renderer) &&
          getItems().some((candidate) => candidate.node === pressedRow.current?.node)
        ) {
          // A focus-entry reveal must not move the clicked row before its release.
          return;
        }
        pressedRow.current = null;
      }
      const root = rootRef.current;
      const area = areaRef.current;
      const item = getItems().find((candidate) => candidate.value === state.current.active);
      if (!root || !area || !item || !isVisible(root)) {
        lastReveal = null;
        return;
      }
      const node = item.node;
      // Content-relative geometry excludes manual scroll offsets: wheel scrolling must not snap back.
      const next = {
        node,
        top: node.screenY - area.content.screenY,
        height: node.height,
        width: node.width,
        viewportHeight: area.viewport.height,
        viewportWidth: area.viewport.width,
        focused: root.focused,
      };
      const reveal =
        !lastReveal ||
        next.node !== lastReveal.node ||
        next.top !== lastReveal.top ||
        next.height !== lastReveal.height ||
        next.width !== lastReveal.width ||
        next.viewportHeight !== lastReveal.viewportHeight ||
        next.viewportWidth !== lastReveal.viewportWidth ||
        (next.focused && !lastReveal.focused);
      lastReveal = next;
      if (reveal) {
        area.scrollChildIntoView(node.id);
        // OpenTUI 0.5.14's nearest-edge reveal misses rows exactly one viewport tall.
        if (node.height === area.viewport.height) {
          area.scrollBy(node.screenY - area.viewport.screenY);
        }
      }
    }
    renderer.on(CliRenderEvents.FRAME, reconcile);
    return () => {
      renderer.off(CliRenderEvents.FRAME, reconcile);
    };
  }, [renderer, repairActive, getItems]);

  const activate = useCallback(
    (value: string) => {
      const target = getItems().find((item) => item.value === value);
      if (!target) {
        return;
      }
      changeActive(value);
      if (!getItems().includes(target)) {
        return;
      }
      const current = state.current;
      if (current.value !== value) {
        if (!current.controlledValue) {
          current.value = value;
          setInternalValue(value);
        }
        current.onValueChange?.(value);
      }
      if (getItems().includes(target)) {
        state.current.onActivate?.(value);
      }
    },
    [getItems, changeActive],
  );

  const beginPress = useCallback(
    (node: BoxRenderable, event: MouseEvent) => {
      const press = consumePrimaryPointerPress(renderer, event);
      if (state.current.disabled || press === undefined) {
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
    const current = eligible[index];
    if (!current) {
      return direction === 1 ? eligible[0] : eligible.at(-1);
    }
    const distance = (areaRef.current?.viewport.height ?? 0) * (half ? 0.5 : 1);
    let target = current;
    for (let next = index + direction; next >= 0 && next < eligible.length; next += direction) {
      target = eligible[next]!;
      if (Math.abs(target.node.screenY - current.node.screenY) >= distance) {
        break;
      }
    }
    return target;
  }

  function handleKeyDown(key: KeyEvent) {
    onKeyDown?.(key);
    if (
      key.defaultPrevented ||
      state.current.disabled ||
      key.propagationStopped ||
      key.meta ||
      key.option ||
      key.super ||
      key.hyper
    ) {
      return;
    }
    const eligible = getItems();
    const index = eligible.findIndex((item) => item.value === state.current.active);
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
      next =
        eligible[
          index < 0
            ? direction === 1
              ? 0
              : eligible.length - 1
            : (index + direction + eligible.length) % eligible.length
        ];
    } else if (!key.ctrl && key.name === "g") {
      next = key.shift ? eligible.at(-1) : eligible[0];
    } else if (!key.ctrl && !key.shift) {
      switch (key.name) {
        case "down":
        case "j":
          next = eligible[index < 0 ? 0 : (index + 1) % eligible.length];
          break;
        case "up":
        case "k":
          next =
            eligible[
              index < 0 ? eligible.length - 1 : (index - 1 + eligible.length) % eligible.length
            ];
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
                ...(!state.current.controlledActive || state.current.onActiveValueChange
                  ? [
                      { keys: "↑/↓/j/k", label: "Navigate" },
                      { keys: "Ctrl+d/u", label: "Half-page" },
                    ]
                  : []),
                ...(getItems().some((item) => item.value === state.current.active)
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
