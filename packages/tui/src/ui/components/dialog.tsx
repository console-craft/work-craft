import { type BoxRenderable, MouseButton, type MouseEvent } from "@opentui/core";
import { createPortal, useRenderer, useTerminalDimensions } from "@opentui/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ButtonProps } from "@/ui/controls/button";
import { Button } from "@/ui/controls/button";
import { useFocusScope } from "@/ui/focus-manager";
import { focusRenderable, isEligibleFocusTarget } from "@/ui/focus-utils";
import { activateModalFocusScope } from "@/ui/modal-focus";
import { Box } from "@/ui/primitives/box";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import type { TextProps } from "@/ui/primitives/text";
import { Text } from "@/ui/primitives/text";
import { assignRef } from "@/ui/utils";

type DialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  closeOnBackdropClick: boolean;
  destructive: boolean;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialog() {
  const context = useContext(DialogContext);

  if (!context) {
    throw new Error("Dialog components must be used within <Dialog>");
  }

  return context;
}

/**
 * Requires a mounted FocusManager for Tab trapping and Escape dismissal.
 * Custom keyboard routers must route these keys through the modal-focus registry.
 */
export interface DialogProps {
  children: ReactNode;

  /** Controlled state is read-only when onOpenChange is absent. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;

  closeOnBackdropClick?: boolean;
  /** Uses the error title variant unless the title explicitly overrides it. */
  destructive?: boolean;
}

export function Dialog(props: DialogProps) {
  const {
    children,
    open,
    defaultOpen = false,
    onOpenChange,
    closeOnBackdropClick = true,
    destructive = false,
  } = props;

  const controlled = open !== undefined;

  const [internalOpen, setInternalOpen] = useState(defaultOpen);

  const currentOpen = open ?? internalOpen;

  const currentOpenRef = useRef(currentOpen);
  const controlledRef = useRef(controlled);
  const onOpenChangeRef = useRef(onOpenChange);

  currentOpenRef.current = currentOpen;
  controlledRef.current = controlled;
  onOpenChangeRef.current = onOpenChange;

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

  const context = useMemo<DialogContextValue>(
    () => ({
      open: currentOpen,
      setOpen,
      closeOnBackdropClick,
      destructive,
    }),
    [currentOpen, setOpen, closeOnBackdropClick, destructive],
  );

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

export interface DialogTriggerProps extends ButtonProps {}

export function DialogTrigger({ onPress, ...props }: DialogTriggerProps) {
  const { setOpen } = useDialog();

  return (
    <Button
      {...props}
      onPress={() => {
        onPress?.();
        setOpen(true);
      }}
    />
  );
}

export interface DialogCloseProps extends ButtonProps {}

export function DialogClose({ onPress, ...props }: DialogCloseProps) {
  const { setOpen } = useDialog();

  return (
    <Button
      {...props}
      onPress={() => {
        onPress?.();
        setOpen(false);
      }}
    />
  );
}

export interface DialogContentProps extends Omit<StackProps, "focusable"> {
  initialFocusId?: string;
}

function resolveWidth(width: number | `${number}%`, availableWidth: number): number {
  return typeof width === "number" ? width : (availableWidth * Number.parseFloat(width)) / 100;
}

export function DialogContent({
  ref,
  id,
  children,

  initialFocusId,

  width = "100%",
  maxWidth = 60,
  minWidth,
  padding = 1,
  gap = 1,

  bg = "background",
  border = true,

  ...props
}: DialogContentProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const overlayPadding = 1;
  const availableWidth = Math.max(0, dimensions.width - overlayPadding * 2);
  // Fractional containing widths can make OpenTUI's measured editors exceed their parent.
  const cellWidth = width === "auto" ? width : Math.round(resolveWidth(width, availableWidth));
  const cellMaxWidth =
    maxWidth === "auto" ? maxWidth : Math.floor(resolveWidth(maxWidth, availableWidth));
  const cellMinWidth =
    minWidth === undefined || minWidth === "auto"
      ? minWidth
      : Math.ceil(resolveWidth(minWidth, availableWidth));

  const { open, setOpen, closeOnBackdropClick, destructive } = useDialog();

  const reactId = useId();

  const generatedScopeId = `dialog-${reactId.replaceAll(":", "")}`;
  const scopeId = id ?? generatedScopeId;

  const scope = useFocusScope(
    open
      ? {
          scopeId,
          scopeKey: scopeId,
          initialFocusId,
          allowRootFocus: true,
        }
      : null,
  );

  const contentRef = useRef<BoxRenderable | null>(null);

  const setContentRef = useCallback(
    (node: BoxRenderable | null) => {
      if (!node) {
        assignRef(ref, null);
        return;
      }

      contentRef.current = node;
      assignRef(ref, node);

      // Capture focus before this dialog's scope repairs focus into itself.
      const restoreTarget = renderer.currentFocusedRenderable;

      const deactivateModal = activateModalFocusScope({
        root: node,
        controller: scope,
        onEscape: () => setOpen(false),
      });

      return () => {
        deactivateModal();

        if (contentRef.current === node) {
          contentRef.current = null;
        }

        assignRef(ref, null);

        queueMicrotask(() => {
          if (restoreTarget && isEligibleFocusTarget(restoreTarget, renderer.root)) {
            focusRenderable(renderer, restoreTarget);
          }
        });
      };
    },
    [ref, renderer, scope, setOpen],
  );

  if (!open) {
    return null;
  }

  function handleBackdropMouseDown(event: MouseEvent) {
    // Never allow the same mouse press to reach application content underneath.
    event.preventDefault();
    event.stopPropagation();

    if (event.button === MouseButton.LEFT && closeOnBackdropClick) {
      setOpen(false);
    }
  }

  return createPortal(
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      paddingX={overlayPadding}
      paddingY={overlayPadding}
      zIndex={1000}
    >
      <Box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        bg="black"
        opacity={0.65}
        onMouseDown={handleBackdropMouseDown}
      />

      <Stack
        borderColor={destructive ? "error" : undefined}
        focusedBorderColor={destructive ? "error" : undefined}
        {...props}
        ref={setContentRef}
        id={scopeId}
        focusable
        width={cellWidth}
        maxWidth={cellMaxWidth}
        minWidth={cellMinWidth}
        paddingX={padding}
        gap={gap}
        bg={bg}
        border={border}
        zIndex={1}
      >
        {children}
      </Stack>
    </Box>,
    renderer.root,
    null,
  );
}

export interface DialogHeaderProps extends StackProps {}

export function DialogHeader({ gap = 0, ...props }: DialogHeaderProps) {
  return <Stack gap={gap} {...props} />;
}

export interface DialogTitleProps extends TextProps {}

export function DialogTitle(props: DialogTitleProps) {
  const { destructive } = useDialog();

  return <Text variant={destructive ? "error" : "heading"} {...props} />;
}

export interface DialogDescriptionProps extends TextProps {}

export function DialogDescription({ variant = "muted", ...props }: DialogDescriptionProps) {
  return <Text variant={variant} {...props} />;
}

export interface DialogFooterProps extends HStackProps {}

export function DialogFooter({
  gap = 1,
  justifyContent = "flex-end",
  ...props
}: DialogFooterProps) {
  return <HStack gap={gap} justifyContent={justifyContent} {...props} />;
}
