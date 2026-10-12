import type { Renderable } from "@opentui/core";

import type { FocusScopeController } from "@/ui/focus-utils";

export type ModalFocusScope = {
  root: Renderable;
  controller: FocusScopeController;
  onEscape: () => void;
};

const modalFocusScopes: ModalFocusScope[] = [];

/** The latest live registration owns modal input; cleanup may run in any order. */
export function activateModalFocusScope(scope: ModalFocusScope): () => void {
  modalFocusScopes.push(scope);

  return () => {
    const index = modalFocusScopes.indexOf(scope);
    if (index !== -1) {
      modalFocusScopes.splice(index, 1);
    }
  };
}

export function getActiveModalFocusScope(): ModalFocusScope | null {
  return modalFocusScopes.at(-1) ?? null;
}
