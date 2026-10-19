import { BoxRenderable, MouseButton, type MouseEvent } from "@opentui/core";
import { createPortal, useRenderer, useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { symbols } from "@/ui/icons/symbols";
import {
  getNotificationStoreController,
  type NotificationRecord,
  type NotificationStore,
  type NotificationVariant,
  notify,
} from "@/ui/notifications";
import { Box } from "@/ui/primitives/box";
import { HStack } from "@/ui/primitives/hstack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export type ToasterPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface ToasterProps {
  store?: NotificationStore;
  position?: ToasterPosition;
  maxVisible?: number;
}

/** Root-anchored, pointer-only presentation of a store's active toasts. */
export function Toaster({
  store = notify,
  position = "bottom-right",
  maxVisible = 3,
}: ToasterProps): ReactNode {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const records = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const control = getNotificationStoreController(store);
  const clips = useRef(new Map<string, BoxRenderable>());
  const limitRef = useRef(maxVisible);
  limitRef.current = maxVisible;

  useLayoutEffect(() => control.connect(renderer, limitRef.current), [control, renderer]);
  useLayoutEffect(() => control.setMaxVisible(maxVisible), [control, maxVisible]);

  const active = records.filter(
    (record) => record.channel === "toast" && record.dismissedAt === null,
  );
  const atTop = position.startsWith("top");
  const atLeft = position.endsWith("left");
  const insetX = dimensions.width >= 3 ? 1 : 0;
  const insetY = dimensions.height >= 3 ? 1 : 0;
  const width = Math.max(0, Math.min(48, dimensions.width - insetX * 2));
  const availableHeight = Math.max(0, dimensions.height - insetY * 2);

  function placeToasts(): void {
    let offset = 0;
    for (const record of active) {
      const clip = clips.current.get(record.id);
      if (!clip) {
        continue;
      }
      if (atTop) {
        clip.top = insetY + offset;
      } else {
        clip.bottom = insetY + offset;
      }
      clip.maxHeight = Math.max(0, availableHeight - offset);
      offset += clip.getChildren()[0]?.getLayout().height ?? 0;
    }
  }

  useLayoutEffect(placeToasts);

  return createPortal(
    active.map((record) => {
      // Native containers claim mouse hits, so clip each toast without a stack-wide overlay.
      return (
        <Box
          key={record.id}
          ref={(node) => {
            if (node) {
              clips.current.set(record.id, node);
            }
            return () => {
              clips.current.delete(record.id);
            };
          }}
          position="absolute"
          top={atTop ? insetY : undefined}
          bottom={atTop ? undefined : insetY}
          left={atLeft ? insetX : undefined}
          right={atLeft ? undefined : insetX}
          width={width}
          maxHeight={availableHeight}
          flexDirection="column"
          justifyContent={atTop ? "flex-start" : "flex-end"}
          overflow="hidden"
          zIndex={1100}
          focusable={false}
        >
          <ToastItem record={record} store={store} onSizeChange={placeToasts} />
        </Box>
      );
    }),
    renderer.root,
    null,
  );
}

const toastSymbols = {
  default: symbols.bullet,
  success: symbols.check,
  warning: symbols.exclamation,
  error: symbols.crossBig,
  info: symbols.info,
} satisfies Record<NotificationVariant, string>;

function isWithin(node: BoxRenderable, event: MouseEvent): boolean {
  return (
    event.x >= node.screenX &&
    event.x < node.screenX + node.width &&
    event.y >= node.screenY &&
    event.y < node.screenY + node.height
  );
}

function stopPointer(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function ToastItem({
  record,
  store,
  onSizeChange,
}: {
  record: NotificationRecord;
  store: NotificationStore;
  onSizeChange(): void;
}): ReactNode {
  const control = getNotificationStoreController(store);
  const action = control.getAction(record.id);
  const color = record.variant === "default" ? "foreground" : record.variant;
  const id = `toast-${record.id}`;

  function onAction(): void {
    const current = control.getAction(record.id);
    if (!current) {
      return;
    }
    current.onPress();
    store.dismiss(record.id);
  }

  return (
    <HStack
      id={id}
      focusable={false}
      width="100%"
      minWidth={0}
      flexShrink={0}
      alignItems="flex-start"
      bg="background"
      border
      borderColor={record.variant === "default" ? "foreground" : record.variant}
      paddingX={1}
      onSizeChange={onSizeChange}
      onMouseOver={() => control.setHovered(record.id, true)}
      onMouseOut={function (event) {
        // Native out events also bubble when moving between descendants.
        if (!isWithin(this, event)) {
          control.setHovered(record.id, false);
        }
      }}
      onMouseDrag={function (event) {
        // Captured child targets suppress out/over; drag coordinates still cross the boundary.
        control.setHovered(record.id, isWithin(this, event));
        stopPointer(event);
      }}
      onMouseDown={stopPointer}
      onMouseUp={stopPointer}
      onMouseScroll={stopPointer}
    >
      <Text id={`${id}-icon`} fg={color} selectable={false} flexShrink={0}>
        {toastSymbols[record.variant]}
      </Text>
      <Stack gap={0} flexGrow={1} flexShrink={1} minWidth={0}>
        <Text id={`${id}-title`} variant="heading" fg={color} selectable={false} minWidth={0}>
          {record.title}
        </Text>
        {record.description !== undefined && (
          <Text id={`${id}-description`} fg="foreground" selectable={false} minWidth={0}>
            {record.description}
          </Text>
        )}
        {action && (
          <PointerControl id={`${id}-action`} onPress={onAction}>
            {action.label}
          </PointerControl>
        )}
      </Stack>
      <PointerControl id={`${id}-close`} onPress={() => store.dismiss(record.id)}>
        {symbols.cross}
      </PointerControl>
    </HStack>
  );
}

function PointerControl({
  id,
  children,
  onPress,
}: {
  id: string;
  children: string;
  onPress: () => void;
}): ReactNode {
  const pressed = useRef(false);
  return (
    <Box
      id={id}
      focusable={false}
      alignSelf="flex-start"
      paddingX={1}
      minWidth={0}
      flexShrink={1}
      onMouseDown={(event) => {
        pressed.current = event.button === MouseButton.LEFT;
        stopPointer(event);
      }}
      onMouseUp={function (event) {
        const wasPressed = pressed.current;
        pressed.current = false;
        stopPointer(event);
        if (wasPressed && event.button === MouseButton.LEFT && isWithin(this, event)) {
          onPress();
        }
      }}
      onMouseOut={function (event) {
        if (!isWithin(this, event)) {
          pressed.current = false;
        }
      }}
      onMouseDrag={function (event) {
        if (!isWithin(this, event)) {
          pressed.current = false;
        }
      }}
    >
      <Text selectable={false} minWidth={0}>
        {children}
      </Text>
    </Box>
  );
}
