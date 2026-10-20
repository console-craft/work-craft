import {
  type BoxRenderable,
  CliRenderEvents,
  type InputRenderable,
  type KeyEvent,
  type MouseEvent,
  type Renderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import type { NavigatorEntry } from "@/navigation/model.ts";
import { escapeLabel, formatPathLabel } from "@/navigation/path-label.ts";
import { List, type ListCursorHandle, ListItem } from "@/ui/components/list";
import { Input } from "@/ui/controls/input";
import { focusRenderable, isEligibleFocusTarget } from "@/ui/focus-utils";
import { consumePrimaryPointerPress, usePointerObservation } from "@/ui/pointer";
import { Box } from "@/ui/primitives/box";
import { HStack } from "@/ui/primitives/hstack";
import { Icon } from "@/ui/primitives/icon";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export type NavigatorProps = {
  entries: readonly NavigatorEntry[];
  query: string;
  activeItemId: string | null;
  initialCursorId: string | null;
  title: string;
  width: number;
  height: number;
  focusedControl: "filter" | "results" | null;
  interactive: boolean;
  homePath: string;
  onQueryChange(query: string): void;
  onCursorChange(id: string | null): void;
  onExpand(rootId: string, expanded: boolean): void;
  onActivate(itemId: string): void;
  onInteraction(): void;
};

export function Navigator(props: NavigatorProps): ReactNode {
  const renderer = useRenderer();
  usePointerObservation();
  const filter = useRef<InputRenderable>(null);
  const list = useRef<BoxRenderable>(null);
  const cursor = useRef<ListCursorHandle>(null);
  const candidate = useRef(props.initialCursorId);
  const [candidateId, setCandidateId] = useState(props.initialCursorId);
  const latestQuery = useRef(props.query);
  const version = useRef(0);
  const pending = useRef<{
    query: string;
    version: number;
    origin: Renderable;
    first: boolean;
  } | null>(null);
  const expanded = useRef(new Map<string, boolean>());
  const live = useRef(props);
  live.current = props;

  useLayoutEffect(() => {
    latestQuery.current = props.query;
    expanded.current = new Map(props.entries.map((entry) => [entry.id, entry.expanded]));
    if (!props.interactive) {
      pending.current = null;
    }
    const request = pending.current;
    if (request && request.query === props.query) {
      pending.current = null;
      if (
        request.version === version.current &&
        renderer.currentFocusedRenderable === request.origin &&
        props.interactive
      ) {
        transfer(request.first);
      }
    } else if (
      renderer.currentFocusedRenderable === list.current &&
      props.initialCursorId !== candidate.current &&
      props.initialCursorId
    ) {
      cursor.current?.focusValue(props.initialCursorId);
    }
  }, [props.query, props.entries, props.interactive, props.initialCursorId]);

  useLayoutEffect(() => {
    const cancel = () => {
      pending.current = null;
      version.current += 1;
    };
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, cancel);
    return () => {
      cancel();
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, cancel);
    };
  }, [renderer]);

  function transfer(first: boolean): void {
    const current = live.current;
    if (!current.interactive || renderer.currentFocusedRenderable !== filter.current) {
      return;
    }
    if (latestQuery.current !== current.query) {
      pending.current = {
        query: latestQuery.current,
        version: version.current,
        origin: filter.current!,
        first,
      };
      return;
    }
    const target =
      !first && current.entries.some((entry) => entry.id === candidate.current)
        ? candidate.current
        : current.entries.find((entry) => entry.matches)?.id;
    if (target) {
      cursor.current?.focusValue(target);
    } else if (!first && current.entries.length === 0 && list.current) {
      focusRenderable(renderer, list.current);
    }
  }

  function localKey(event: KeyEvent, endpoint: "filter" | "results"): void {
    if (!live.current.interactive) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const plain = !event.ctrl && !event.meta && !event.option && !event.super && !event.hyper;
    const transferKey =
      endpoint === "filter" &&
      event.ctrl &&
      !event.shift &&
      !event.meta &&
      !event.option &&
      !event.super &&
      !event.hyper &&
      event.name === "n";
    if ((plain && event.name === "tab") || transferKey) {
      event.preventDefault();
      event.stopPropagation();
      props.onInteraction();
      if (endpoint === "filter") {
        transfer(transferKey);
      } else if (filter.current && isEligibleFocusTarget(filter.current, renderer.root)) {
        focusRenderable(renderer, filter.current);
      }
      return;
    }
    if (endpoint === "filter" && ["return", "enter", "linefeed"].includes(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    pending.current = null;
    props.onInteraction();
    if (endpoint !== "results" || !plain || event.shift || props.query !== "") {
      return;
    }
    const entry = props.entries.find((entry) => entry.id === candidate.current);
    if (
      entry?.depth !== 0 ||
      !entry.hasChildren ||
      !["h", "left", "l", "right", "space"].includes(event.name)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    expand(
      entry,
      event.name === "space"
        ? !expanded.current.get(entry.id)
        : ["l", "right"].includes(event.name),
    );
  }

  function expand(entry: NavigatorEntry, value: boolean): void {
    if (expanded.current.get(entry.id) !== value) {
      expanded.current.set(entry.id, value);
      props.onExpand(entry.id, value);
    }
  }

  function pointerInteraction(): void {
    if (props.interactive) {
      props.onInteraction();
    }
  }

  const press = useRef<{ id: string; token: number } | null>(null);
  function disclosure(entry: NavigatorEntry, event: MouseEvent, release: boolean): void {
    event.preventDefault();
    event.stopPropagation();
    const token = consumePrimaryPointerPress(renderer, event);
    if (!release) {
      pointerInteraction();
      press.current = token === undefined ? null : { id: entry.id, token };
      return;
    }
    const held = press.current;
    press.current = null;
    const node = renderer.root.findDescendantById(`disclosure:${entry.id}`);
    if (
      !props.interactive ||
      props.query !== "" ||
      !node ||
      held?.id !== entry.id ||
      held.token !== token ||
      event.x < node.screenX ||
      event.x >= node.screenX + node.width ||
      event.y < node.screenY ||
      event.y >= node.screenY + node.height
    ) {
      return;
    }
    props.onInteraction();
    expand(entry, !expanded.current.get(entry.id));
  }

  return (
    <Stack
      id="navigator-controls"
      width={props.width}
      height={props.height}
      minHeight={0}
      gap={1}
      bg="muted"
      paddingX={1}
      paddingTop={1}
    >
      <Text height={1} fg="primary" variant="label">
        {props.title.toUpperCase()}
      </Text>
      <Box bg="muted" border>
        <Input
          id="navigator:filter"
          onMouseDown={pointerInteraction}
          ref={filter}
          value={props.query}
          disabled={!props.interactive}
          focused={props.focusedControl === "filter"}
          placeholder="Filter…"
          onInput={(query) => {
            version.current += 1;
            pending.current = null;
            latestQuery.current = query;
            props.onInteraction();
            props.onQueryChange(query);
          }}
          onKeyDown={(event) => localKey(event, "filter")}
        />
      </Box>
      <List
        id="region:navigator"
        onMouseDown={pointerInteraction}
        ref={list}
        cursorRef={cursor}
        value={props.activeItemId ?? undefined}
        defaultActiveValue={props.initialCursorId ?? undefined}
        disabled={!props.interactive}
        horizontalScrolling
        focused={props.focusedControl === "results"}
        flexGrow={1}
        minHeight={0}
        onActiveValueChange={(id) => {
          candidate.current = id ?? null;
          setCandidateId(id ?? null);
          props.onCursorChange(id ?? null);
        }}
        onActivate={(id) => {
          if (latestQuery.current === props.query && props.interactive) {
            props.onInteraction();
            props.onActivate(id);
          }
        }}
        onKeyDown={(event) => localKey(event, "results")}
        controlHints={() => {
          const entry = live.current.entries.find((entry) => entry.id === candidate.current);
          return entry
            ? [
                { keys: "Enter", label: "Open" },
                ...(entry.hasChildren && live.current.query === ""
                  ? [{ keys: "Space", label: "Expand" }]
                  : []),
              ]
            : [];
        }}
      >
        {props.entries.map((entry) => {
          const item = entry.item;
          const active = item.id === props.activeItemId;
          const focused = props.focusedControl === "results" && item.id === candidateId;
          const color = focused ? "focusForeground" : active ? "primaryForeground" : "foreground";
          const quiet = focused
            ? "focusForeground"
            : active
              ? "primaryForeground"
              : "mutedForeground";
          const icon =
            item.kind === "worktree"
              ? "worktree"
              : item.kind === "directory"
                ? item.data.isGitCheckout
                  ? "repo"
                  : "folder"
                : "folder";
          const unavailable =
            entry.failed ||
            (item.kind !== "generic" &&
              (item.data.availability === "unavailable" ||
                (item.kind === "directory" && item.data.discoveryError)));
          const iconColor = focused
            ? "focusForeground"
            : active
              ? "primaryForeground"
              : unavailable
                ? "accent"
                : "foreground";
          return (
            <ListItem
              key={item.id}
              id={`navigator-row:${item.id}`}
              onMouseDown={pointerInteraction}
              value={item.id}
              paddingLeft={0 + entry.depth * 2}
            >
              <Box flexDirection="row" height={1}>
                {entry.hasChildren && props.query === "" ? (
                  <Text
                    id={`disclosure:${item.id}`}
                    width={2}
                    onMouseDown={(event) => disclosure(entry, event, false)}
                    onMouseUp={(event) => disclosure(entry, event, true)}
                  >
                    {entry.expanded ? "▾ " : "▸ "}
                  </Text>
                ) : (
                  <Text width={2}></Text>
                )}
                <HStack gap={1} flexShrink={0}>
                  <Icon name={unavailable ? "warning" : icon} fg={iconColor} />
                  <Text fg={color}>{escapeLabel(item.title)}</Text>
                  <Text fg={focused ? "foreground" : active ? "primaryForeground" : "warning"}>
                    {item.kind === "generic" ||
                    (item.kind === "directory" && !item.data.isGitCheckout)
                      ? ""
                      : ` · ${escapeLabel(item.data.branch ?? "detached")}`}
                  </Text>
                </HStack>
              </Box>
              <Text fg={quiet} height={1} marginLeft={4}>
                {item.kind === "generic"
                  ? ""
                  : formatPathLabel(
                      item.data.path,
                      props.homePath,
                      Math.max(0, props.width - 5 - entry.depth * 2),
                    )}
              </Text>
            </ListItem>
          );
        })}
        {props.entries.length === 0 ? (
          <Text fg="mutedForeground">{props.query ? "No matches" : "No items"}</Text>
        ) : null}
      </List>
    </Stack>
  );
}
