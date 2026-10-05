import { createCliRenderer, EmbeddedTerminalRenderable } from "@opentui/core";
import { createRoot, extend } from "@opentui/react";

import { App } from "@/app.tsx";
import { ComponentsDemo } from "@/demos/components";
import { ControlsDemo } from "@/demos/controls";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    terminal: typeof EmbeddedTerminalRenderable;
  }
}

extend({ terminal: EmbeddedTerminalRenderable });

let component = null;

switch (true) {
  case process.env.CONTROLS_DEMO === "true":
    component = <ControlsDemo />;
    break;
  case process.env.COMPONENTS_DEMO === "true":
    component = <ComponentsDemo />;
    break;
  default:
    component = <App />;
}

const renderer = await createCliRenderer({
  exitOnCtrlC: process.env.CONTROLS_DEMO === "true" || process.env.COMPONENTS_DEMO === "true",
  useKittyKeyboard: { disambiguate: true },
});
createRoot(renderer).render(component);
