import {
  type BoxRenderable,
  CliRenderEvents,
  type InputRenderable,
  isRenderable,
  type Renderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CommandProps } from "@/ui/components/command";
import { cyclicIndex, pageIndex, renderedOrder } from "@/ui/interaction/collection";

export type CommandItemRegistration = {
  id: string;
  groupId: string | null;
  value: string;
  disabled: boolean;
  visible: boolean;
  node: BoxRenderable | null;
  onSelect?: () => void;
};

export type CommandContextValue = {
  direction: "up" | "down";
  query: string;
  setQuery: (query: string) => void;
  getQuery: () => string;

  activeId: string | null;
  matchingCount: number;

  rootRef: { current: BoxRenderable | null };
  listRef: {
    current: ScrollBoxRenderable | null;
  };
  filterHiddenGroups: WeakMap<object, boolean>;
  inputRef: { current: InputRenderable | null };

  matchesValue: (value: string) => boolean;
  groupHasMatches: (groupId: string) => boolean;

  registerItem: (item: CommandItemRegistration) => () => void;

  getItem: (id: string) => CommandItemRegistration | undefined;

  setActive: (id: string) => void;
  moveActive: (direction: 1 | -1) => void;
  movePage: (direction: 1 | -1, amount: "half" | "full") => void;

  selectItem: (id: string) => void;
  selectActive: () => void;
  canSelectActive: () => boolean;

  /** Forces consumers to observe item registry changes. */
  registryVersion: number;
};

export function useCommandState({
  direction = "down",
  query,
  defaultQuery = "",
  onQueryChange,
  filter,
}: Pick<
  CommandProps,
  "direction" | "query" | "defaultQuery" | "onQueryChange" | "filter"
>): CommandContextValue {
  const renderer = useRenderer();
  const controlled = query !== undefined;

  const [internalQuery, setInternalQuery] = useState(defaultQuery);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const previousDirection = useRef(direction);

  // Native input can navigate and submit before React commits the highlight.
  const updateActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const [registryVersion, setRegistryVersion] = useState(0);

  const currentQuery = query ?? internalQuery;

  const currentQueryRef = useRef(currentQuery);
  const controlledRef = useRef(controlled);
  const onQueryChangeRef = useRef(onQueryChange);

  currentQueryRef.current = currentQuery;
  controlledRef.current = controlled;
  onQueryChangeRef.current = onQueryChange;

  const itemsRef = useRef(new Map<string, CommandItemRegistration>());
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const listRef = useRef<ScrollBoxRenderable | null>(null);
  const rootRef = useRef<BoxRenderable | null>(null);
  const inputRef = useRef<InputRenderable | null>(null);
  const filterHiddenGroups = useRef(new WeakMap<object, boolean>());
  const getQuery = useCallback(() => currentQueryRef.current, []);
  const matchesValue = useCallback(
    (value: string) => {
      if (filter === false) {
        return true;
      }

      const query = currentQueryRef.current;
      const trimmedQuery = query.trim();

      if (trimmedQuery.length === 0) {
        return true;
      }

      if (filter) {
        return filter(value, query);
      }

      return value.toLocaleLowerCase().includes(trimmedQuery.toLocaleLowerCase());
    },
    [filter],
  );

  const isItemVisible = useCallback(
    (item: CommandItemRegistration): item is CommandItemRegistration & { node: BoxRenderable } => {
      if (!item.visible || !item.node || item.node.isDestroyed) {
        return false;
      }
      // Row/group filter visibility can lag buffered query edits; declared visibility stays authoritative.
      for (let node = item.node.parent; node; node = node.parent) {
        if (
          (isRenderable(node) && node.isDestroyed) ||
          (!node.visible && !filterHiddenGroups.current.get(node))
        ) {
          return false;
        }
      }
      return true;
    },
    [],
  );

  const getMatchingItems = useCallback(() => {
    const candidates = new Map<Renderable, CommandItemRegistration & { node: BoxRenderable }>();
    for (const item of itemsRef.current.values()) {
      if (isItemVisible(item) && matchesValue(item.value)) {
        candidates.set(item.node, item);
      }
    }
    return renderedOrder(rootRef.current, candidates);
  }, [isItemVisible, matchesValue]);

  const getEnabledItems = useCallback(() => {
    return getMatchingItems().filter((item) => !item.disabled);
  }, [getMatchingItems]);

  const ensureActive = useCallback(
    (reset = false) => {
      const enabled = getEnabledItems();
      if (!reset && enabled.some((item) => item.id === activeIdRef.current)) {
        return;
      }
      updateActive((direction === "up" ? enabled.at(-1) : enabled[0])?.id ?? null);
    },
    [direction, getEnabledItems, updateActive],
  );

  const setQuery = useCallback(
    (nextQuery: string) => {
      if (nextQuery === currentQueryRef.current) {
        return;
      }
      if (!controlledRef.current) {
        currentQueryRef.current = nextQuery;
        setInternalQuery(nextQuery);
        ensureActive();
      }
      onQueryChangeRef.current?.(nextQuery);
    },
    [ensureActive],
  );

  const registerItem = useCallback((item: CommandItemRegistration) => {
    itemsRef.current.set(item.id, item);

    setRegistryVersion((version) => version + 1);

    return () => {
      if (itemsRef.current.get(item.id) === item) {
        itemsRef.current.delete(item.id);
        if (mountedRef.current) {
          setRegistryVersion((version) => version + 1);
        }
      }
    };
  }, []);

  const getItem = useCallback((id: string) => {
    return itemsRef.current.get(id);
  }, []);

  const groupHasMatches = useCallback(
    (groupId: string) => {
      // Only filtering owns this visibility; native ancestor hiding is a separate eligibility gate.
      return [...itemsRef.current.values()].some(
        (item) => item.groupId === groupId && item.visible && matchesValue(item.value),
      );
    },
    [matchesValue],
  );

  const setActive = useCallback(
    (id: string) => {
      const item = itemsRef.current.get(id);

      if (!item || item.disabled || !isItemVisible(item) || !matchesValue(item.value)) {
        return;
      }

      updateActive(id);
    },
    [isItemVisible, matchesValue, updateActive],
  );

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      const items = getEnabledItems();

      if (items.length === 0) {
        updateActive(null);
        return;
      }

      const index = items.findIndex((item) => item.id === activeIdRef.current);
      const nextIndex = cyclicIndex(items.length, index, direction)!;
      updateActive(items[nextIndex]!.id);
    },
    [getEnabledItems, updateActive],
  );

  const movePage = useCallback(
    (direction: 1 | -1, amount: "half" | "full") => {
      const items = getEnabledItems();

      if (items.length === 0) {
        updateActive(null);
        return;
      }

      const currentIndex = items.findIndex((item) => item.id === activeIdRef.current);

      if (currentIndex === -1) {
        updateActive(direction === 1 ? items[0]!.id : items.at(-1)!.id);

        return;
      }

      const area = listRef.current;

      if (!area) {
        moveActive(direction);
        return;
      }

      const viewportDistance = area.viewport.height * (amount === "half" ? 0.5 : 1);

      const targetIndex = pageIndex(
        items.map((item) => item.node.screenY),
        currentIndex,
        direction,
        viewportDistance,
      )!;
      updateActive(items[targetIndex]!.id);
    },
    [getEnabledItems, moveActive, updateActive],
  );

  const selectItem = useCallback(
    (id: string) => {
      const item = itemsRef.current.get(id);

      if (!item || item.disabled || !isItemVisible(item) || !matchesValue(item.value)) {
        return;
      }

      item.onSelect?.();
    },
    [isItemVisible, matchesValue],
  );

  const selectActive = useCallback(() => {
    if (activeIdRef.current) {
      selectItem(activeIdRef.current);
    }
  }, [selectItem]);

  const canSelectActive = useCallback(() => {
    return getEnabledItems().some((item) => item.id === activeIdRef.current);
  }, [getEnabledItems]);

  const matchingCount = getMatchingItems().length;
  const matchingCountRef = useRef(matchingCount);
  matchingCountRef.current = matchingCount;

  useLayoutEffect(() => {
    function reconcileVisibility() {
      ensureActive();
      const count = getMatchingItems().length;
      if (count !== matchingCountRef.current) {
        matchingCountRef.current = count;
        setRegistryVersion((version) => version + 1);
      }
    }
    renderer.on(CliRenderEvents.FRAME, reconcileVisibility);
    return () => {
      renderer.off(CliRenderEvents.FRAME, reconcileVisibility);
    };
  }, [renderer, ensureActive, getMatchingItems]);

  useLayoutEffect(() => {
    ensureActive(previousDirection.current !== direction);
    previousDirection.current = direction;
  }, [currentQuery, registryVersion, direction, ensureActive]);

  const context = useMemo<CommandContextValue>(
    () => ({
      direction,
      query: currentQuery,
      setQuery,
      getQuery,

      activeId,
      matchingCount,

      rootRef,
      listRef,
      inputRef,
      filterHiddenGroups: filterHiddenGroups.current,

      matchesValue,
      groupHasMatches,

      registerItem,
      getItem,

      setActive,
      moveActive,
      movePage,

      selectItem,
      selectActive,
      canSelectActive,

      registryVersion,
    }),
    [
      direction,
      currentQuery,
      setQuery,
      getQuery,
      activeId,
      matchingCount,
      matchesValue,
      groupHasMatches,
      registerItem,
      getItem,
      setActive,
      moveActive,
      movePage,
      selectItem,
      selectActive,
      canSelectActive,
      registryVersion,
    ],
  );

  return context;
}
