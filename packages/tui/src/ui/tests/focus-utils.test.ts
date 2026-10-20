import { expect, test } from "bun:test";

import { BoxRenderable, RenderableEvents } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import {
  createFocusScope,
  getFocusableRenderables,
  isEligibleFocusTarget,
  isWithinScope,
  moveFocus,
  observeControlFocus,
} from "@/ui/focus-utils";
import { setDisabled } from "@/ui/utils";

test("control focus observation initializes native focus and releases replaced-node listeners", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const first = new BoxRenderable(renderer, { id: "first", focusable: true });
  const second = new BoxRenderable(renderer, { id: "second", focusable: true });
  renderer.root.add(first);
  renderer.root.add(second);
  const firstValues: boolean[] = [];
  const secondValues: boolean[] = [];
  const focusedCount = first.listenerCount(RenderableEvents.FOCUSED);
  const blurredCount = first.listenerCount(RenderableEvents.BLURRED);
  first.focus();
  let release = observeControlFocus(first, (value) => firstValues.push(value));
  try {
    expect(firstValues).toEqual([true]);
    first.blur();
    first.focus();
    expect(firstValues).toEqual([true, false, true]);
    expect(first.listenerCount(RenderableEvents.FOCUSED)).toBe(focusedCount + 1);
    expect(first.listenerCount(RenderableEvents.BLURRED)).toBe(blurredCount + 1);
    release();
    expect(first.listenerCount(RenderableEvents.FOCUSED)).toBe(focusedCount);
    expect(first.listenerCount(RenderableEvents.BLURRED)).toBe(blurredCount);
    release = observeControlFocus(second, (value) => secondValues.push(value));
    second.focus();
    first.focus();
    expect(firstValues).toEqual([true, false, true]);
    expect(secondValues).toEqual([false, true, false]);
    release();
    release = observeControlFocus(first, (value) => firstValues.push(value));
    expect(first.listenerCount(RenderableEvents.FOCUSED)).toBe(focusedCount + 1);
    expect(first.listenerCount(RenderableEvents.BLURRED)).toBe(blurredCount + 1);
  } finally {
    release();
    renderer.destroy();
  }
});

test("scope repair preserves focus, skips ineligible controls, and never escapes", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const scope = new BoxRenderable(renderer, { id: "scope", focusable: true });
  const outside = new BoxRenderable(renderer, { id: "outside", focusable: true });
  const first = new BoxRenderable(renderer, { id: "first", focusable: true });
  const hidden = new BoxRenderable(renderer, { id: "hidden", visible: false });
  const hiddenChild = new BoxRenderable(renderer, { id: "hidden-child", focusable: true });
  const second = new BoxRenderable(renderer, { id: "second", focusable: true });
  renderer.root.add(outside);
  renderer.root.add(scope);
  scope.add(first);
  scope.add(hidden);
  hidden.add(hiddenChild);
  scope.add(second);
  const controller = createFocusScope(renderer, scope, "first");
  try {
    expect(controller.repair()).toBe(first);
    expect(controller.move(1)).toBe(second);
    expect(controller.repair()).toBe(second);
    expect(controller.move(1)).toBe(first);
    expect(controller.move(-1)).toBe(second);
    second.focusable = false;
    expect(controller.repair()).toBe(first);
    expect(second.focused).toBe(false);
    expect(controller.repair()).toBe(first);
    scope.remove(first);
    first.destroyRecursively();
    expect(controller.repair()).toBe(scope);
    expect(renderer.currentFocusedRenderable).not.toBe(outside);
    second.focusable = true;
    expect(controller.repair()).toBe(second);
    scope.visible = false;
    expect(controller.repair()).toBeNull();
    expect(second.focused).toBe(false);
  } finally {
    renderer.destroy();
  }
});

test("removing a focused middle child repairs to its surviving successor", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const scope = new BoxRenderable(renderer, { id: "scope", focusable: true });
  const first = new BoxRenderable(renderer, { id: "first", focusable: true });
  const middle = new BoxRenderable(renderer, { id: "middle", focusable: true });
  const last = new BoxRenderable(renderer, { id: "last", focusable: true });
  renderer.root.add(scope);
  scope.add(first);
  scope.add(middle);
  scope.add(last);
  const controller = createFocusScope(renderer, scope, "first");
  try {
    expect(controller.repair()).toBe(first);
    expect(controller.move(1)).toBe(middle);
    scope.remove(middle);
    middle.destroyRecursively();
    expect(controller.repair()).toBe(last);
    expect(controller.move(1)).toBe(first);
  } finally {
    renderer.destroy();
  }
});

test("eligibility includes ancestors outside the scope and disabling detaches native focus", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const ancestor = new BoxRenderable(renderer, { id: "ancestor" });
  const scope = new BoxRenderable(renderer, { id: "scope", focusable: true });
  const child = new BoxRenderable(renderer, { id: "child", focusable: true });
  renderer.root.add(ancestor);
  ancestor.add(scope);
  scope.add(child);
  const controller = createFocusScope(renderer, scope);
  try {
    expect(isWithinScope(child, scope)).toBe(true);
    expect(isWithinScope(ancestor, scope)).toBe(false);
    expect(getFocusableRenderables(scope)).toEqual([child]);
    expect(controller.repair()).toBe(child);
    child.focusable = false;
    setDisabled(child, true);
    expect(child.focused).toBe(false);
    expect(renderer.currentFocusedRenderable).toBeNull();
    expect(controller.repair()).toBe(scope);
    setDisabled(child, false);
    expect(controller.repair()).toBe(child);
    ancestor.visible = false;
    expect(isEligibleFocusTarget(child, scope)).toBe(false);
    expect(getFocusableRenderables(scope)).toEqual([]);
    expect(controller.repair()).toBeNull();
    expect(child.focused).toBe(false);
    expect(moveFocus(renderer, 1, scope)).toBeNull();
    ancestor.visible = true;
    scope.remove(child);
    child.destroyRecursively();
    scope.focusable = false;
    expect(controller.repair()).toBeNull();
    scope.destroyRecursively();
    expect(controller.move(1)).toBeNull();
  } finally {
    renderer.destroy();
  }
});

test("repair detaches an invalid scoped listener when the boundary cannot receive focus", async () => {
  const { renderer, mockInput } = await createTestRenderer({ width: 40, height: 10 });
  let keypresses = 0;
  const scope = new BoxRenderable(renderer, { id: "scope", focusable: false });
  const child = new BoxRenderable(renderer, {
    id: "child",
    focusable: true,
    onKeyDown() {
      keypresses += 1;
    },
  });
  const outside = new BoxRenderable(renderer, { id: "outside", focusable: true });
  renderer.root.add(scope);
  renderer.root.add(outside);
  scope.add(child);
  const controller = createFocusScope(renderer, scope);
  try {
    expect(controller.repair()).toBe(child);
    mockInput.pressKey("a");
    expect(keypresses).toBe(1);
    child.focusable = false;
    expect(controller.repair()).toBeNull();
    mockInput.pressKey("a");
    expect(keypresses).toBe(1);
    expect(renderer.currentFocusedRenderable).toBeNull();
    expect(child.focused).toBe(false);
    expect(child.focusable).toBe(false);
    expect(controller.move(1)).toBeNull();
    outside.focus();
    expect(controller.repair()).toBeNull();
    expect(renderer.currentFocusedRenderable?.id).toBe("outside");
    child.focusable = true;
    expect(controller.repair()).toBe(child);
    mockInput.pressKey("a");
    expect(keypresses).toBe(2);
  } finally {
    renderer.destroy();
  }
});

test("page scopes can opt into deliberate root focus without adding a Tab stop", async () => {
  const { renderer } = await createTestRenderer({ width: 40, height: 10 });
  const root = new BoxRenderable(renderer, { id: "page", focusable: true });
  const first = new BoxRenderable(renderer, { id: "first", focusable: true });
  const last = new BoxRenderable(renderer, { id: "last", focusable: true });
  renderer.root.add(root);
  root.add(first);
  root.add(last);
  const strict = createFocusScope(renderer, root);
  const page = createFocusScope(renderer, root, undefined, true);
  try {
    root.focus();
    expect(strict.repair()).toBe(first);
    root.focus();
    expect(page.repair()?.id).toBe(root.id);
    expect(page.move(1)).toBe(first);
    expect(page.move(1)).toBe(last);
    expect(page.move(1)).toBe(first);
    root.focus();
    expect(page.move(-1)).toBe(last);
  } finally {
    renderer.destroy();
  }
});
