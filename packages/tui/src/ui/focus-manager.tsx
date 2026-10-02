import { CliRenderEvents, isRenderable, type Renderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { createFocusScope, type FocusScopeController } from "@/ui/focus-utils";

/** A missing scope is inert, including during buffered input and scope replacement. */
export function useFocusScope(
  request: { scopeId: string; scopeKey: string; initialFocusId?: string } | null,
): FocusScopeController {
  const renderer = useRenderer();
  const requestRef = useRef(request);
  requestRef.current = request;
  const mounted = useRef(false);
  const cached = useRef<{
    key: string;
    root: Renderable;
    controller: FocusScopeController;
  } | null>(null);

  const controller = useMemo<FocusScopeController>(() => {
    function resolve(): FocusScopeController | null {
      const current = requestRef.current;
      const root = current ? renderer.root.findDescendantById(current.scopeId) : undefined;
      if (!mounted.current || !current || !isRenderable(root) || root.isDestroyed) {
        cached.current = null;
        return null;
      }
      if (cached.current?.key !== current.scopeKey || cached.current.root !== root) {
        cached.current = {
          key: current.scopeKey,
          root,
          controller: createFocusScope(renderer, root, current.initialFocusId),
        };
      }
      return cached.current.controller;
    }
    return {
      repair: () => resolve()?.repair() ?? null,
      move: (direction) => resolve()?.move(direction) ?? null,
    };
  }, [renderer]);

  useLayoutEffect(() => {
    mounted.current = true;
    let active = true;
    let queued = false;
    function repair() {
      controller.repair();
    }
    function queueRepair() {
      if (queued) {
        return;
      }
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) {
          repair();
        }
      });
    }
    renderer.on(CliRenderEvents.FRAME, repair);
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, queueRepair);
    return () => {
      active = false;
      mounted.current = false;
      renderer.off(CliRenderEvents.FRAME, repair);
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, queueRepair);
    };
  }, [renderer, controller, request?.scopeId, request?.scopeKey]);

  useLayoutEffect(() => {
    controller.repair();
  });

  return controller;
}

/** Observes the native focus authority without installing input policy. */
export function useNativeFocus(): Renderable | null {
  const renderer = useRenderer();
  const [focused, setFocused] = useState<Renderable | null>(null);
  useLayoutEffect(() => {
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, setFocused);
    setFocused(renderer.currentFocusedRenderable);
    return () => {
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, setFocused);
    };
  }, [renderer]);
  return focused;
}

export type FocusManagerProps = {
  focusScopeId: string;
};

export function FocusManager({ focusScopeId }: FocusManagerProps) {
  const renderer = useRenderer();
  const scope = useFocusScope({ scopeId: focusScopeId, scopeKey: focusScopeId });

  useKeyboard((key) => {
    if (
      key.defaultPrevented ||
      key.name !== "tab" ||
      key.ctrl ||
      key.meta ||
      key.option ||
      key.super ||
      key.hyper ||
      !isRenderable(renderer.root.findDescendantById(focusScopeId))
    ) {
      return;
    }

    key.preventDefault();

    scope.move(key.shift ? -1 : 1);
  });

  return null;
}
