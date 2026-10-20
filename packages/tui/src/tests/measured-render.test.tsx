import { expect, test } from "bun:test";

import type { TestRendererSetup } from "@opentui/core/testing";
import { act, useLayoutEffect, useState } from "react";

import { flushMeasured } from "@/tests/support/measured-render";
import { testRender } from "@/tests/support/render";

test("measured rendering forwards flush arguments in two separate awaited acts", async () => {
  const calls: string[] = [];
  let call = 0;
  const options = { maxPasses: 3 };
  const setup: Pick<TestRendererSetup, "flush"> = {
    async flush(received) {
      expect(received).toBe(options);
      const index = ++call;
      calls.push(`start ${index}`);
      await Promise.resolve();
      calls.push(`end ${index}`);
    },
  };
  await flushMeasured(setup, options);
  expect(calls).toEqual(["start 1", "end 1", "start 2", "end 2"]);
});

for (const rejectedCall of [1, 2]) {
  test(`measured rendering propagates rejection from frame ${rejectedCall}`, async () => {
    const failure = new Error("frame failed");
    let calls = 0;
    await expect(
      flushMeasured({
        async flush() {
          if (++calls === rejectedCall) {
            throw failure;
          }
        },
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(rejectedCall);
  });
}

test("measured rendering commits frame metadata before measuring the following frame", async () => {
  let publish: () => void = () => {};
  let committed = false;
  function FrameMetadata() {
    const [measured, setMeasured] = useState(false);
    publish = () => setMeasured(true);
    useLayoutEffect(() => {
      committed = measured;
    }, [measured]);
    return <text>{measured ? "measured" : "pending"}</text>;
  }
  const setup = await testRender(<FrameMetadata />, { width: 20, height: 3 });
  try {
    let frames = 0;
    await flushMeasured({
      async flush(options) {
        if (++frames === 1) {
          publish();
        } else {
          expect(committed).toBe(true);
        }
        await setup.flush(options);
      },
    });
    expect(frames).toBe(2);
  } finally {
    act(() => setup.renderer.destroy());
  }
});
