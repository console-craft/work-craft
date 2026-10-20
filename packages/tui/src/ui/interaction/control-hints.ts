import { CliRenderEvents, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import { isEligibleFocusTarget } from "@/ui/interaction/focus-utils";

export type ControlHint = { keys: string; label: string };

/** Live getters reflect native state changes that do not cause a React render. */
export type ControlHintSource = readonly ControlHint[] | (() => readonly ControlHint[]);

const hintsByNode = new WeakMap<Renderable, { hints: ControlHintSource }>();
const emptyHints: readonly ControlHint[] = [];

/** Metadata belongs to the native endpoint, never to its siblings or ancestors. */
export function useControlHints(ref: RefObject<Renderable | null>, hints: ControlHintSource): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    // Unique ownership even when two registrations reuse the same hint array.
    const entry = { hints: typeof hints === "function" ? hints : [...hints] };
    hintsByNode.set(node, entry);
    node.requestRender();
    return () => {
      if (hintsByNode.get(node) === entry) {
        hintsByNode.delete(node);
        node.requestRender();
      }
    };
  });
}

export function getControlHints(node: Renderable | null): readonly ControlHint[] {
  if (
    node === null ||
    node.ctx.currentFocusedRenderable !== node ||
    !isEligibleFocusTarget(node, node)
  ) {
    return emptyHints;
  }
  const hints = hintsByNode.get(node)?.hints;
  return typeof hints === "function" ? hints() : (hints ?? emptyHints);
}

/** FRAME observes late registration and same-node changes without a custom event bus. */
export function useFocusedControlHints(): readonly ControlHint[] {
  const renderer = useRenderer();
  const [hints, setHints] = useState(() => getControlHints(renderer.currentFocusedRenderable));
  const current = useRef(hints);
  useLayoutEffect(() => {
    function publish(): void {
      const next = getControlHints(renderer.currentFocusedRenderable);
      if (
        next.length === current.current.length &&
        next.every(
          (hint, index) =>
            hint.keys === current.current[index]!.keys &&
            hint.label === current.current[index]!.label,
        )
      ) {
        return;
      }
      current.current = next;
      setHints(next);
    }
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, publish);
    renderer.on(CliRenderEvents.FRAME, publish);
    publish();
    return () => {
      renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, publish);
      renderer.off(CliRenderEvents.FRAME, publish);
    };
  }, [renderer]);
  return hints;
}

type NativeBinding = {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  super?: boolean;
  action: string;
};

// OpenTUI 0.5.11 keeps these internal. Mirror its raw chord merge and ONE-HOP
// alias pass for presentation only; native handlers remain the behavior owner.
const nativeAliases: Record<string, string> = {
  enter: "return",
  esc: "escape",
  kpenter: "enter",
  kp0: "0",
  kp1: "1",
  kp2: "2",
  kp3: "3",
  kp4: "4",
  kp5: "5",
  kp6: "6",
  kp7: "7",
  kp8: "8",
  kp9: "9",
  kpdecimal: ".",
  kpdivide: "/",
  kpmultiply: "*",
  kpminus: "-",
  kpplus: "+",
  kpequal: "=",
  kpseparator: ",",
  kpleft: "left",
  kpright: "right",
  kpup: "up",
  kpdown: "down",
  kppageup: "pageup",
  kppagedown: "pagedown",
  kphome: "home",
  kpend: "end",
  kpinsert: "insert",
  kpdelete: "delete",
};

function chord(binding: NativeBinding): string {
  return `${binding.name}:${+!!binding.ctrl}:${+!!binding.shift}:${+!!binding.meta}:${+!!binding.super}`;
}

/** Resolve ALL native actions before filtering acceptance, including movement overrides. */
export function nativeActionHints(
  bindings: readonly NativeBinding[],
  action: string,
  label: string,
  keyAliasMap: Record<string, string> = {},
  locallyHandled: (binding: NativeBinding) => boolean = () => false,
): readonly ControlHint[] {
  const raw = new Map(bindings.map((binding) => [chord(binding), binding]));
  const effective = new Map(raw);
  const aliases = { ...nativeAliases, ...keyAliasMap };
  for (const binding of raw.values()) {
    const name = aliases[binding.name] || binding.name;
    if (name !== binding.name) {
      const aliased = { ...binding, name };
      effective.set(chord(aliased), aliased);
    }
  }
  const keys = new Set<string>();
  for (const binding of effective.values()) {
    if (binding.action !== action || locallyHandled(binding)) {
      continue;
    }
    const ordinaryEnter = effective.get(chord({ ...binding, name: "return" }));
    const name =
      ["enter", "kpenter", "linefeed"].includes(binding.name) && ordinaryEnter?.action === action
        ? "return"
        : binding.name;
    const displayName =
      (
        {
          return: "Enter",
          enter: "Enter (alias)",
          kpenter: "Keypad Enter",
          linefeed: "Linefeed",
          escape: "Escape",
          space: "Space",
        } as Record<string, string>
      )[name] ?? name;
    keys.add(
      [
        binding.ctrl ? "Ctrl" : null,
        binding.shift ? "Shift" : null,
        binding.meta ? "Meta" : null,
        binding.super ? "Super" : null,
        displayName,
      ]
        .filter(Boolean)
        .join("+"),
    );
  }
  return [...keys].map((keys) => ({ keys, label }));
}
