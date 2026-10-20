import {
  createTestRenderer,
  type TestRendererOptions,
  type TestRendererSetup,
} from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act, type ReactNode } from "react";

import { configureRendererListeners } from "@/ui/renderer";

/** Keep the act environment enabled through deferred unmount effects, too. */
export async function testRender(
  node: ReactNode,
  options: TestRendererOptions,
): Promise<TestRendererSetup> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let root: ReturnType<typeof createRoot> | null = null;
  const setup = await createTestRenderer({
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
  act(() => root?.render(node));
  return setup;
}
