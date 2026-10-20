import { expect, test } from "bun:test";

import { MouseButton, MouseEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import {
  consumePrimaryPointerPress,
  isPrimaryPointerPressed,
  observePointer,
  pointerPosition,
} from "@/ui/interaction/pointer";

function mouse(type: "down" | "up", x: number, y: number): MouseEvent {
  return new MouseEvent(null, {
    type,
    button: MouseButton.LEFT,
    x,
    y,
    modifiers: { shift: false, alt: false, ctrl: false },
  });
}

test("pointer observation is shared, released by the final owner and reacquired without a scroll area", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const baseline = renderer.stdin.listenerCount("data");
  const first = observePointer(renderer);
  let release = observePointer(renderer);
  try {
    expect(renderer.stdin.listenerCount("data")).toBe(baseline + 1);
    first();
    expect(renderer.stdin.listenerCount("data")).toBe(baseline + 1);
    renderer.stdin.emit("data", Buffer.from("\x1b[<0;6;8M"));
    expect(pointerPosition(renderer)).toEqual({ x: 5, y: 7 });
    expect(isPrimaryPointerPressed(renderer)).toBe(true);
    release();
    expect(renderer.stdin.listenerCount("data")).toBe(baseline);
    expect(pointerPosition(renderer)).toBeUndefined();
    expect(isPrimaryPointerPressed(renderer)).toBe(false);
    release = observePointer(renderer);
    expect(renderer.stdin.listenerCount("data")).toBe(baseline + 1);
  } finally {
    release();
    renderer.destroy();
  }
});

test("fragmented real reports update pointer state but mouse-shaped bracketed paste does not", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const release = observePointer(renderer);
  try {
    renderer.stdin.emit("data", "\x1b[200~\x1b[<0;2;3M\x1b[201~");
    expect(pointerPosition(renderer)).toBeUndefined();
    expect(isPrimaryPointerPressed(renderer)).toBe(false);
    renderer.stdin.emit("data", "\x1b[<0;6;");
    expect(pointerPosition(renderer)).toBeUndefined();
    renderer.stdin.emit("data", "8M");
    expect(pointerPosition(renderer)).toEqual({ x: 5, y: 7 });
    expect(consumePrimaryPointerPress(renderer, mouse("down", 5, 7))).toBe(1);
    renderer.stdin.emit("data", "\x1b[<0;30;9m");
    expect(isPrimaryPointerPressed(renderer)).toBe(false);
    expect(consumePrimaryPointerPress(renderer, mouse("up", 29, 8))).toBe(1);
  } finally {
    release();
    renderer.destroy();
  }
});

test("same-batch gestures have distinct tokens and consuming a later report discards stale presses", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const release = observePointer(renderer);
  try {
    renderer.stdin.emit("data", "\x1b[<0;2;3M\x1b[<0;30;9m\x1b[<0;5;6M\x1b[<0;5;6m");
    expect(consumePrimaryPointerPress(renderer, mouse("down", 1, 2))).toBe(1);
    expect(consumePrimaryPointerPress(renderer, mouse("up", 29, 8))).toBe(1);
    expect(consumePrimaryPointerPress(renderer, mouse("down", 4, 5))).toBe(2);
    expect(consumePrimaryPointerPress(renderer, mouse("up", 4, 5))).toBe(2);
    expect(isPrimaryPointerPressed(renderer)).toBe(false);
    expect(consumePrimaryPointerPress(renderer, mouse("up", 4, 5))).toBeUndefined();
    renderer.stdin.emit("data", "\x1b[<0;2;3M\x1b[<0;30;9m");
    expect(consumePrimaryPointerPress(renderer, mouse("up", 29, 8))).toBe(3);
    expect(consumePrimaryPointerPress(renderer, mouse("down", 1, 2))).toBeUndefined();
  } finally {
    release();
    renderer.destroy();
  }
});
