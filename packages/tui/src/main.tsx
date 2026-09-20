import { createCliRenderer, EmbeddedTerminalRenderable } from "@opentui/core";
import { createRoot, extend } from "@opentui/react";
import { App } from "./app.tsx";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    terminal: typeof EmbeddedTerminalRenderable;
  }
}

extend({ terminal: EmbeddedTerminalRenderable });

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useKittyKeyboard: { disambiguate: true },
});
createRoot(renderer).render(<App />);
