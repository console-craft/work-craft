import { expect, spyOn, test } from "bun:test";

import { act } from "react";

import { ComponentsDemo } from "@/demos/components";
import { testRender } from "@/tests/support/render";

test("destroying a mounted component tree keeps React cleanup inside act", async () => {
  const errors: string[] = [];
  const error = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.map(String).join(" "));
  });
  try {
    const setup = await testRender(<ComponentsDemo />, { width: 100, height: 24 });
    await act(async () => setup.flush());
    await act(async () => setup.renderer.destroy());
    await setup.renderer.closed;
    expect(errors.filter((message) => message.includes("act("))).toEqual([]);
  } finally {
    error.mockRestore();
  }
});
