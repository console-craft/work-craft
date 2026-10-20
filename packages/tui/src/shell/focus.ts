import type { BaseRenderable, CliRenderer, Renderable } from "@opentui/core";

import type { FocusTarget } from "@/input/focus.ts";
import { focusRenderable, isEligibleFocusTarget } from "@/ui/interaction/focus-utils.ts";

export function nativeFocusId(target: FocusTarget): string {
  return target.region === "workbench"
    ? `${target.control ?? "terminal"}:${target.paneId}`
    : target.region === "navigator" && target.control === "filter"
      ? "navigator:filter"
      : `region:${target.region}`;
}

/** Recognizes shell endpoints through child ancestry without a second focus registry. */
export function focusTargetFor(node: Renderable | null): FocusTarget | null {
  for (let current: BaseRenderable | null = node; current !== null; current = current.parent) {
    switch (current.id) {
      case "region:workspace":
        return { region: "workspace" };
      case "region:session":
        return { region: "session" };
      case "region:category":
        return { region: "category" };
      case "region:navigator":
        return { region: "navigator" };
      case "navigator:filter":
        return { region: "navigator", control: "filter" };
      case "region:tabs":
        return { region: "tabs" };
      case "dialog-overlay":
        return null;
    }
    if (current.id.startsWith("terminal:") && current.id.length > "terminal:".length) {
      return { region: "workbench", paneId: current.id.slice("terminal:".length) };
    }
    if (current.id.startsWith("reactivate:") && current.id.length > "reactivate:".length) {
      return {
        region: "workbench",
        paneId: current.id.slice("reactivate:".length),
        control: "reactivate",
      };
    }
  }
  return null;
}

export function focusShellTarget(renderer: CliRenderer, target: FocusTarget): boolean {
  const node = renderer.root.findDescendantById(nativeFocusId(target));
  return (
    node !== undefined &&
    isEligibleFocusTarget(node, renderer.root) &&
    focusRenderable(renderer, node) !== null
  );
}
