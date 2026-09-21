import { createCliRenderer, EmbeddedTerminalRenderable } from "@opentui/core";
import { createRoot, extend } from "@opentui/react";

import { App } from "@/app.tsx";
import { UIDemo } from "@/ui-demo.tsx";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    terminal: typeof EmbeddedTerminalRenderable;
  }
}

extend({ terminal: EmbeddedTerminalRenderable });

const showUIDemo = process.env.UI_DEMO === "true";

const renderer = await createCliRenderer({
  exitOnCtrlC: showUIDemo,
  useKittyKeyboard: { disambiguate: true },
});
createRoot(renderer).render(showUIDemo ? <UIDemo /> : <App />);
