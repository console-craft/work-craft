import type { CliRenderer } from "@opentui/core";

/** UI controls subscribe individually; the full demo uses 32 renderer listeners. */
export function configureRendererListeners(renderer: CliRenderer): void {
  // Finite, instance-local headroom; global/process leak diagnostics stay unchanged.
  renderer.setMaxListeners(64);
  renderer.keyInput.setMaxListeners(64);
}
