import { CliRenderEvents, isRenderable, type KeyEvent, type Renderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  createFocusScope,
  type FocusScopeController,
  isWithinScope,
} from "@/ui/interaction/focus-utils";
import { getActiveModalFocusScope } from "@/ui/interaction/modal-focus";

/** A missing scope is inert, including during buffered input and scope replacement. */
export function useFocusScope(
  request: {
    scopeId: string;
    scopeKey: string;
    initialFocusId?: string;
    allowRootFocus?: boolean;
  } | null,
): FocusScopeController {
  const renderer = useRenderer();
  const requestRef = useRef(request);
  requestRef.current = request;

  const mounted = useRef(false);

  const cached = useRef<{
    key: string;
    root: Renderable;
    allowRootFocus: boolean;
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

      const modal = getActiveModalFocusScope();

      // Ordinary application scopes must not pull focus out of a modal.
      // Scopes nested inside the modal remain fully functional.
      if (modal && !isWithinScope(root, modal.root)) {
        return null;
      }

      const allowRootFocus = current.allowRootFocus ?? false;

      if (
        cached.current?.key !== current.scopeKey ||
        cached.current.root !== root ||
        cached.current.allowRootFocus !== allowRootFocus
      ) {
        cached.current = {
          key: current.scopeKey,
          root,
          allowRootFocus,
          controller: createFocusScope(renderer, root, current.initialFocusId, allowRootFocus),
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
  }, [renderer, controller, request?.scopeId, request?.scopeKey, request?.allowRootFocus]);

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

  /** Allows intentional page-background focus while child controls remain Tab targets. */
  allowRootFocus?: boolean;
};

export function FocusManager({ focusScopeId, allowRootFocus = false }: FocusManagerProps) {
  const renderer = useRenderer();

  const scope = useFocusScope({
    scopeId: focusScopeId,
    scopeKey: focusScopeId,
    allowRootFocus,
  });

  useKeyboard((key: KeyEvent) => {
    if (key.defaultPrevented || key.ctrl || key.meta || key.option || key.super || key.hyper) {
      return;
    }

    const modal = getActiveModalFocusScope();

    if (modal && key.name === "escape") {
      // Global hooks run before controls; dismiss only if local dispatch leaves Escape unhandled.
      queueMicrotask(() => {
        if (
          !key.defaultPrevented &&
          !key.propagationStopped &&
          !modal.root.isDestroyed &&
          getActiveModalFocusScope() === modal
        ) {
          key.preventDefault();
          key.stopPropagation();
          modal.onEscape();
        }
      });

      return;
    }

    if (key.name !== "tab") {
      return;
    }

    if (modal) {
      key.preventDefault();
      key.stopPropagation();

      modal.controller.move(key.shift ? -1 : 1);

      return;
    }

    if (!isRenderable(renderer.root.findDescendantById(focusScopeId))) {
      return;
    }

    // Preserve your existing non-modal Tab policy.
    key.preventDefault();

    scope.move(key.shift ? -1 : 1);
  });

  return null;
}
