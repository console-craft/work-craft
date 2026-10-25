import { expect, spyOn, test } from "bun:test";

import type { TextRenderable } from "@opentui/core";
import { act, useLayoutEffect, useState } from "react";

import { ComponentsDemo } from "@/demos/components";
import { flushMeasured } from "@/tests/support/measured-render";
import { testRender } from "@/tests/support/render";

test("asynchronous mounting and tree cleanup keep React updates inside act", async () => {
  function MountStatus() {
    const [status, setStatus] = useState("pending");
    useLayoutEffect(() => {
      void Promise.resolve().then(() => setStatus("mounted"));
    }, []);
    return <text id="mount-status">{status}</text>;
  }
  const errors: string[] = [];
  const error = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.map(String).join(" "));
  });
  try {
    const setup = await testRender(
      <>
        <MountStatus />
        <ComponentsDemo />
      </>,
      { width: 100, height: 24 },
    );
    try {
      await flushMeasured(setup);
      const status = setup.renderer.root.findDescendantById("mount-status") as TextRenderable;
      expect(status.plainText).toBe("mounted");
    } finally {
      await act(async () => setup.renderer.destroy());
      await setup.renderer.closed;
    }
    expect(errors.filter((message) => message.includes("act("))).toEqual([]);
  } finally {
    error.mockRestore();
  }
});
