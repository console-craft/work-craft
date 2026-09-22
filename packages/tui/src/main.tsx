import { createCliRenderer, EmbeddedTerminalRenderable } from "@opentui/core";
import { createRoot, extend } from "@opentui/react";
import { App } from "./app.tsx";
import { TermcnKitchenSink } from "./kitchen-sink.tsx";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    terminal: typeof EmbeddedTerminalRenderable;
  }
}

extend({ terminal: EmbeddedTerminalRenderable });

const showTermcnKitchenSink = process.env.DEBUG_TERMCN === "true";
const renderer = await createCliRenderer({
  exitOnCtrlC: showTermcnKitchenSink,
  useKittyKeyboard: { disambiguate: true },
});
createRoot(renderer).render(showTermcnKitchenSink ? <TermcnKitchenSink /> : <App />);
