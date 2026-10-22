import { CliRenderEvents, createCliRenderer } from "@opentui/core";
import { createRoot, extend } from "@opentui/react";

import { App } from "@/app.tsx";
import { observeOutput, outputProbeEnabled } from "@/client/output-probe";
import { ComponentsDemo } from "@/demos/components";
import { ControlsDemo } from "@/demos/controls";
import { configureRendererListeners } from "@/ui/renderer";
import { TerminalMaterialRenderable } from "@/workbench/terminal-material";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    terminal: typeof TerminalMaterialRenderable;
  }
}

extend({ terminal: TerminalMaterialRenderable });

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
  exitOnCtrlC: false,
  useKittyKeyboard: { disambiguate: true },
});
configureRendererListeners(renderer);
if (outputProbeEnabled) {
  let previous = performance.now();
  renderer.on(CliRenderEvents.FRAME, () => {
    const now = performance.now();
    observeOutput({ stage: "frame", durationMs: now - previous });
    observeOutput({
      stage: "native.scene",
      aggregateOnly: true,
      durationMs: renderer.lastSceneTimeMs,
    });
    previous = now;
  });
}
if (process.env.CONTROLS_DEMO === "true" || process.env.COMPONENTS_DEMO === "true") {
  renderer.keyInput.on("keypress", (event) => {
    if (
      event.name !== "c" ||
      !event.ctrl ||
      event.shift ||
      event.meta ||
      event.option ||
      event.super ||
      event.hyper
    ) {
      return;
    }
    // Global listeners run before controls; quit only after local dispatch has had its turn.
    queueMicrotask(() => {
      if (!event.defaultPrevented && !event.propagationStopped) {
        renderer.destroy();
      }
    });
  });
}
createRoot(renderer).render(component);
// Teardown is asynchronous in OpenTUI 0.6; propagate output failures to the entrypoint.
await renderer.closed;
