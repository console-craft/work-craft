import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";

/** Commit frame metadata before measuring the pane rectangles in the next frame. */
export async function flushMeasured(
  setup: Pick<TestRendererSetup, "flush">,
  ...args: Parameters<TestRendererSetup["flush"]>
): Promise<void> {
  await act(async () => setup.flush(...args));
  await act(async () => setup.flush(...args));
}
