import {
  type BoxRenderable,
  type KeyEvent,
  type MouseEvent,
  RenderableEvents,
} from "@opentui/core";
import type { Snapshot } from "@work-craft/server/client";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Box } from "@/ui/primitives/box.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { TAB_STRIP_HEIGHT } from "@/workbench/layout";

export type TabBarProps = {
  tabs: Snapshot["tabs"];
  activeId: string | null;
  cursorId: string | null;
  focused: boolean;
  failed?: boolean;
  inputEnabled?: boolean;
  entryEnabled?: boolean;
  canReceiveInput?(): boolean;
  onActivate(id: string): void;
  onEnter(id: string): void;
  onFocus(id: string): void;
  onScrollInteraction(): void;
};

export function TabBar(props: TabBarProps): ReactNode {
  const regionRef = useRef<BoxRenderable | null>(null);
  const live = useRef(props);
  live.current = props;
  const candidate = useRef(props.cursorId ?? props.activeId);
  candidate.current = props.cursorId ?? props.activeId;

  function enabled(): boolean {
    return live.current.inputEnabled !== false && (live.current.canReceiveInput?.() ?? true);
  }
  function gate(event: KeyEvent | MouseEvent): void {
    if (!enabled()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  useLayoutEffect(() => {
    const node = regionRef.current;
    if (!node) {
      return;
    }
    function refocus(): void {
      const id = live.current.activeId;
      if (enabled() && id !== null) {
        candidate.current = id;
        live.current.onFocus(id);
      }
    }
    node.on(RenderableEvents.FOCUSED, refocus);
    return () => {
      node.off(RenderableEvents.FOCUSED, refocus);
    };
  }, []);
  useLayoutEffect(() => {
    if (regionRef.current) {
      regionRef.current.focusable = props.inputEnabled !== false;
    }
  });

  return (
    <Box flexDirection="row" height={TAB_STRIP_HEIGHT} flexShrink={0} minWidth={0}>
      <Tabs
        value={props.cursorId ?? props.activeId ?? undefined}
        flexGrow={1}
        minWidth={0}
        onValueChange={(id) => {
          if (!enabled()) {
            return;
          }
          candidate.current = id;
          live.current.onFocus(id);
        }}
        onActivate={(id) => {
          if (enabled() && live.current.entryEnabled !== false) {
            live.current.onActivate(id);
            live.current.onEnter(id);
          }
        }}
      >
        <TabsList
          id="region:tabs"
          ref={regionRef}
          refocusValue={props.activeId ?? undefined}
          controlHints={() =>
            enabled() &&
            live.current.entryEnabled !== false &&
            live.current.tabs.some(({ id }) => id === candidate.current)
              ? [{ keys: "Enter/Space", label: "Enter terminal" }]
              : []
          }
          focused={props.inputEnabled !== false && props.focused}
          onKeyDown={gate}
          onScrollInteraction={() => {
            if (enabled()) {
              live.current.onScrollInteraction();
            }
          }}
          onMouseDown={(event) => {
            gate(event);
            if (enabled() && candidate.current !== null) {
              live.current.onScrollInteraction();
              live.current.onFocus(candidate.current);
            }
          }}
          bg="background"
        >
          {props.tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              id={`tab:${tab.id}`}
              value={tab.id}
              onMouseDown={gate}
              onMouseUp={gate}
              flexGrow={1}
              flexBasis={0}
              justifyContent="center"
            >
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {props.failed ? (
        <Text id="tab-error" flexShrink={0} fg="error">
          !
        </Text>
      ) : null}
    </Box>
  );
}
