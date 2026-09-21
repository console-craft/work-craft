import { useKeyboard, useRenderer } from "@opentui/react";

import { moveFocus } from "@/ui/focus-utils";

export type FocusManagerProps = {
  focusScopeId?: string;
};

export function FocusManager({ focusScopeId }: FocusManagerProps) {
  const renderer = useRenderer();

  useKeyboard((key) => {
    if (key.name !== "tab") {
      return;
    }

    key.preventDefault();

    const scope =
      focusScopeId === undefined
        ? renderer.root
        : (renderer.root.findDescendantById(focusScopeId) ?? renderer.root);
    moveFocus(renderer, key.shift ? -1 : 1, scope);
  });

  return null;
}
