import {
  createTestRenderer,
  type TestRendererOptions,
  type TestRendererSetup,
} from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act, type ReactNode } from "react";

import { configureRendererListeners } from "@/ui/renderer";

/** Await mount effects without explicitly flushing native frames; keep act enabled through cleanup. */
export async function testRender(
  node: ReactNode,
  options: TestRendererOptions,
): Promise<TestRendererSetup> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let root: ReturnType<typeof createRoot> | null = null;
  const setup = await createTestRenderer({
    // Keep real frames without waiting for interactive UI frame pacing.
    targetFps: 1000,
    maxFps: 1000,
    ...options,
    onDestroy() {
      act(() => {
        root?.unmount();
        root = null;
      });
      options.onDestroy?.();
    },
  });
  configureRendererListeners(setup.renderer);
  root = createRoot(setup.renderer);
  await act(async () => root?.render(node));
  return setup;
}
