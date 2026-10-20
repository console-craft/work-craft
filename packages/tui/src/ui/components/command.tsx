import {
  type BoxRenderable,
  CliRenderEvents,
  defaultTextareaKeyBindings,
  type InputRenderable,
  type KeyEvent,
  MouseButton,
  type MouseEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import {
  Children,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { type CommandContextValue, useCommandState } from "@/ui/components/command-state";
import { nativeActionHints, useControlHints } from "@/ui/control-hints";
import { Input, type InputProps, inputSubmitBindings } from "@/ui/controls/input";
import { focusRenderable, isEligibleFocusTarget } from "@/ui/focus-utils";
import { symbols } from "@/ui/icons/symbols";
import { Box, type BoxProps } from "@/ui/primitives/box";
import { HStack } from "@/ui/primitives/hstack";
import { ScrollArea, type ScrollAreaProps } from "@/ui/primitives/scroll-area";
import { Text, type TextProps } from "@/ui/primitives/text";
import { assignRef, isTextContent } from "@/ui/utils";

export type CommandFilter = (value: string, query: string) => boolean;

const CommandContext = createContext<CommandContextValue | null>(null);

function useCommand(component: string) {
  const context = useContext(CommandContext);

  if (!context) {
    throw new Error(`${component} must be used within <Command>`);
  }

  return context;
}

type CommandGroupContextValue = {
  id: string;
  visible: boolean;
};

const CommandGroupContext = createContext<CommandGroupContextValue | null>(null);

function inferItemValue(children: ReactNode): string {
  if (!isTextContent(children)) {
    return "";
  }

  return Children.toArray(children).map(String).join("");
}

function hasOtherModifier(event: KeyEvent) {
  return event.meta || event.option || event.super || event.hyper;
}

function isWithinItem(node: BoxRenderable, event: MouseEvent): boolean {
  return (
    event.x >= node.screenX &&
    event.x < node.screenX + node.width &&
    event.y >= node.screenY &&
    event.y < node.screenY + node.height
  );
}

export interface CommandProps extends Omit<BoxProps, "children"> {
  children: ReactNode;
  /** Places results below/above the input and chooses the initial first/last enabled match. */
  direction?: "up" | "down";

  /** Controlled state is read-only when onQueryChange is absent. */
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;

  /**
   * false disables built-in filtering.
   * Useful when items are filtered externally.
   */
  filter?: false | CommandFilter;
}

export function Command({
  ref,
  children,
  direction = "down",

  query,
  defaultQuery = "",
  onQueryChange,

  filter,

  flexDirection = direction === "up" ? "column-reverse" : "column",

  ...props
}: CommandProps) {
  const context = useCommandState({ direction, query, defaultQuery, onQueryChange, filter });
  const rootRef = context.rootRef;
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

  return (
    <CommandContext.Provider value={context}>
      <Box {...props} ref={setRootRef} flexDirection={flexDirection}>
        {children}
      </Box>
    </CommandContext.Provider>
  );
}

export interface CommandInputProps extends Omit<InputProps, "value" | "onSubmit"> {}

export function CommandInput({
  ref,
  disabled = false,

  onInput,
  onChange,
  onKeyDown,

  submitLabel = "Run",
  keyBindings = [],
  keyAliasMap,
  marginTop,
  marginBottom,

  ...props
}: CommandInputProps) {
  const command = useCommand("CommandInput");

  const inputRef = command.inputRef;
  const syncingQuery = useRef(false);
  useControlHints(inputRef, () =>
    !disabled && command.canSelectActive()
      ? nativeActionHints(
          [...defaultTextareaKeyBindings, ...inputSubmitBindings, ...keyBindings],
          "submit",
          submitLabel,
          keyAliasMap,
          (binding) =>
            !binding.shift &&
            !binding.meta &&
            !binding.super &&
            (binding.ctrl
              ? ["n", "p", "d", "u", "f", "b"].includes(binding.name) ||
                (binding.name === "c" && (inputRef.current?.plainText.length ?? 0) > 0)
              : ["up", "down"].includes(binding.name)),
        )
      : [],
  );

  const setInputRef = useCallback(
    (node: InputRenderable | null) => {
      inputRef.current = node;
      assignRef(ref, node);

      return () => {
        if (inputRef.current === node) {
          inputRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref, inputRef],
  );

  function handleInput(value: string) {
    if (syncingQuery.current) {
      return;
    }
    command.setQuery(value);
    const input = inputRef.current;
    if (input && input.value !== command.getQuery()) {
      // Let buffered edits accumulate before restoring an unacknowledged controlled query.
      queueMicrotask(() => {
        if (input.isDestroyed || inputRef.current !== input || input.value === command.getQuery()) {
          return;
        }
        syncingQuery.current = true;
        try {
          input.value = command.getQuery();
        } finally {
          syncingQuery.current = false;
        }
      });
    }
    onInput?.(value);
  }

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || event.propagationStopped || disabled || hasOtherModifier(event)) {
      return;
    }

    if (!event.ctrl && !event.shift && event.name === "down") {
      event.preventDefault();
      event.stopPropagation();

      command.moveActive(1);
      return;
    }

    if (!event.ctrl && !event.shift && event.name === "up") {
      event.preventDefault();
      event.stopPropagation();

      command.moveActive(-1);
      return;
    }

    if (!event.ctrl || event.shift) {
      return;
    }

    switch (event.name) {
      case "n":
        event.preventDefault();
        event.stopPropagation();

        command.moveActive(1);
        break;

      case "p":
        event.preventDefault();
        event.stopPropagation();

        command.moveActive(-1);
        break;

      case "d":
        event.preventDefault();
        event.stopPropagation();

        command.movePage(1, "half");
        break;

      case "u":
        event.preventDefault();
        event.stopPropagation();

        command.movePage(-1, "half");
        break;

      case "f":
        event.preventDefault();
        event.stopPropagation();

        command.movePage(1, "full");
        break;

      case "b":
        event.preventDefault();
        event.stopPropagation();

        command.movePage(-1, "full");
        break;
    }
  }

  return (
    <Input
      {...props}
      ref={setInputRef}
      disabled={disabled}
      value={command.query}
      submitLabel={submitLabel}
      keyBindings={keyBindings}
      keyAliasMap={keyAliasMap}
      onInput={handleInput}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      onSubmit={() => {
        command.selectActive();
      }}
      marginTop={marginTop ?? (command.direction === "up" ? 1 : undefined)}
      marginBottom={marginBottom ?? (command.direction === "down" ? 1 : undefined)}
    />
  );
}

export interface CommandListProps extends Omit<ScrollAreaProps, "keyboardFallback" | "focusable"> {}

export function CommandList({
  ref,
  children,

  scrollX = false,
  scrollY = true,
  contentOptions,

  ...props
}: CommandListProps) {
  const renderer = useRenderer();
  const command = useCommand("CommandList");

  const setListRef = useCallback(
    (node: ScrollBoxRenderable | null) => {
      command.listRef.current = node;
      assignRef(ref, node);

      return () => {
        if (command.listRef.current === node) {
          command.listRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [command.listRef, ref],
  );

  useLayoutEffect(() => {
    const area = command.listRef.current;

    if (!area || !command.activeId) {
      return;
    }

    const item = command.getItem(command.activeId);

    const node = item?.node;

    if (!node || node.isDestroyed) {
      return;
    }
    const target = node;

    function reveal() {
      renderer.off(CliRenderEvents.FRAME, reveal);

      const currentArea = command.listRef.current;

      const currentItem = command.activeId ? command.getItem(command.activeId) : undefined;

      if (!currentArea || currentItem?.node !== target || target.isDestroyed) {
        return;
      }

      currentArea.scrollChildIntoView(target.id);
    }

    renderer.on(CliRenderEvents.FRAME, reveal);

    area.requestRender();

    return () => {
      renderer.off(CliRenderEvents.FRAME, reveal);
    };
  }, [
    command.activeId,
    command.query,
    command.registryVersion,
    command.direction,
    command.getItem,
    command.listRef,
    renderer,
  ]);

  return (
    <ScrollArea
      {...props}
      ref={setListRef}
      scrollX={scrollX}
      scrollY={scrollY}
      contentOptions={{
        ...contentOptions,
        justifyContent:
          contentOptions?.justifyContent ??
          (command.direction === "up" ? "flex-end" : "flex-start"),
      }}
      keyboardFallback={false}
      focusable={false}
    >
      {children}
    </ScrollArea>
  );
}

export interface CommandGroupProps extends Omit<BoxProps, "children"> {
  children: ReactNode;
  heading?: ReactNode;
}

export function CommandGroup({
  ref,
  children,
  heading,

  visible = true,
  flexDirection = "column",

  ...props
}: CommandGroupProps) {
  const command = useCommand("CommandGroup");
  const parent = useContext(CommandGroupContext);
  const declaredVisible = visible && (parent?.visible ?? true);

  const reactId = useId();

  const groupId = `command-group-${reactId.replaceAll(":", "")}`;

  const hasMatches = command.groupHasMatches(groupId);

  const setGroupRef = useCallback(
    (node: BoxRenderable | null) => {
      if (node) {
        command.filterHiddenGroups.set(node, !hasMatches);
      }
      assignRef(ref, node);
      return () => {
        if (node) {
          command.filterHiddenGroups.delete(node);
        }
        assignRef(ref, null);
      };
    },
    [command.filterHiddenGroups, hasMatches, ref],
  );

  const context = useMemo<CommandGroupContextValue>(
    () => ({
      id: groupId,
      visible: declaredVisible,
    }),
    [groupId, declaredVisible],
  );

  return (
    <CommandGroupContext.Provider value={context}>
      <Box
        {...props}
        ref={setGroupRef}
        visible={declaredVisible && hasMatches}
        flexDirection={flexDirection}
      >
        {heading !== undefined ? (
          isTextContent(heading) ? (
            <Text variant="muted" marginBottom={1}>
              {heading}
            </Text>
          ) : (
            heading
          )
        ) : null}

        {children}
      </Box>
    </CommandGroupContext.Provider>
  );
}

export interface CommandItemProps extends Omit<BoxProps, "focusable"> {
  value?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

export function CommandItem({
  ref,
  id,
  children,

  value,
  disabled = false,
  visible = true,
  onSelect,

  bg,
  paddingX = 1,
  alignSelf = "stretch",

  onMouseOver,
  onMouseDown,
  onMouseUp,
  onMouseOut,

  ...props
}: CommandItemProps) {
  const renderer = useRenderer();
  const command = useCommand("CommandItem");
  const group = useContext(CommandGroupContext);

  const reactId = useId();

  const itemId = `command-item-${reactId.replaceAll(":", "")}`;

  const renderId = id ?? itemId;

  const nodeRef = useRef<BoxRenderable | null>(null);

  const mousePressedRef = useRef(false);

  const searchableValue = value ?? inferItemValue(children);

  const declaredVisible = visible && (group?.visible ?? true);

  const matches = declaredVisible && command.matchesValue(searchableValue);

  const active = command.activeId === itemId;

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
    return command.registerItem({
      id: itemId,
      groupId: group?.id ?? null,
      value: searchableValue,
      disabled,
      visible: declaredVisible,
      node: nodeRef.current,
      onSelect,
    });
  }, [
    itemId,
    group?.id,
    searchableValue,
    disabled,
    declaredVisible,
    onSelect,
    command.registerItem,
  ]);

  function handleMouseOver(this: BoxRenderable, event: MouseEvent) {
    onMouseOver?.call(this, event);

    if (event.defaultPrevented || event.propagationStopped || disabled || !matches) {
      return;
    }

    command.setActive(itemId);
  }

  function handleMouseDown(this: BoxRenderable, event: MouseEvent) {
    mousePressedRef.current = false;
    onMouseDown?.call(this, event);

    if (
      event.defaultPrevented ||
      event.propagationStopped ||
      disabled ||
      !matches ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }

    mousePressedRef.current = true;
    command.setActive(itemId);
    const input = command.inputRef.current;
    if (input && isEligibleFocusTarget(input, input)) {
      focusRenderable(renderer, input);
    }
  }

  function handleMouseUp(this: BoxRenderable, event: MouseEvent) {
    const wasPressed = mousePressedRef.current;

    mousePressedRef.current = false;

    onMouseUp?.call(this, event);

    if (
      event.defaultPrevented ||
      event.propagationStopped ||
      disabled ||
      !matches ||
      !wasPressed ||
      !isWithinItem(this, event) ||
      event.button !== MouseButton.LEFT
    ) {
      return;
    }

    command.selectItem(itemId);
  }

  function handleMouseOut(this: BoxRenderable, event: MouseEvent) {
    if (!isWithinItem(this, event)) {
      mousePressedRef.current = false;
    }
    onMouseOut?.call(this, event);
  }

  const fg = disabled ? "mutedForeground" : active ? "focusForeground" : "foreground";

  return (
    <HStack
      {...props}
      ref={setItemRef}
      id={renderId}
      visible={matches}
      focusable={false}
      alignSelf={alignSelf}
      paddingX={paddingX}
      bg={active ? "focus" : bg}
      onMouseOver={handleMouseOver}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseOut={handleMouseOut}
    >
      <Text fg={fg}>{active ? symbols.triangleRightFilled : " "}</Text>
      {isTextContent(children) ? <Text fg={fg}>{children}</Text> : children}
    </HStack>
  );
}

export interface CommandEmptyProps extends TextProps {}

export function CommandEmpty({ visible = true, variant = "muted", ...props }: CommandEmptyProps) {
  const command = useCommand("CommandEmpty");

  return <Text {...props} visible={visible && command.matchingCount === 0} variant={variant} />;
}
