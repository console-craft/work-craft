import { type CliRenderer, MouseButton, type MouseEvent, StdinParser } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useLayoutEffect } from "react";

// An inner area's stopped wheel event must update its ancestors' pointer coordinates too.
const pointerPositions = new WeakMap<CliRenderer, { x: number; y: number }>();
const primaryPointerPressed = new WeakMap<CliRenderer, boolean>();
type PointerPressReport = { type: "down" | "up"; x: number; y: number; press: number | undefined };
const pointerPressReports = new WeakMap<CliRenderer, PointerPressReport[]>();
const pointerObservers = new WeakMap<CliRenderer, { users: number; dispose: () => void }>();

export function pointerPosition(renderer: CliRenderer): { x: number; y: number } | undefined {
  return pointerPositions.get(renderer);
}

export function recordPointerPosition(
  renderer: CliRenderer,
  point: { x: number; y: number },
): void {
  pointerPositions.set(renderer, point);
}

/** Includes releases dispatched outside a composite's rows. */
export function isPrimaryPointerPressed(renderer: CliRenderer): boolean {
  return primaryPointerPressed.get(renderer) ?? false;
}

/** Match native dispatch to its primary gesture, including multiple gestures in one input chunk. */
export function consumePrimaryPointerPress(
  renderer: CliRenderer,
  event: MouseEvent,
): number | undefined {
  const reports = pointerPressReports.get(renderer);
  const index =
    reports?.findIndex(
      (report) => report.type === event.type && report.x === event.x && report.y === event.y,
    ) ?? -1;
  if (!reports || index < 0) {
    return undefined;
  }
  const press = reports[index]!.press;
  reports.splice(0, index + 1);
  return press;
}

/** Acquire the one prepend observer; release once when this consumer unmounts. */
export function observePointer(renderer: CliRenderer): () => void {
  let observer = pointerObservers.get(renderer);
  if (!observer) {
    const parser = new StdinParser({ armTimeouts: false });
    let disposed = false;
    let nextPress = 0;
    let currentPress: number | undefined;
    function handleData(chunk: Buffer | string) {
      if (disposed) {
        return;
      }
      // Expire a standalone Escape before it can merge with a later mouse report.
      parser.flushTimeout(performance.now());
      parser.drain(() => {});
      const reports: PointerPressReport[] = [];
      pointerPressReports.set(renderer, reports);
      parser.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      parser.drain((event) => {
        if (event.type === "mouse") {
          // shortcut: full-screen coordinates, normalize reports if split-footer mode is introduced.
          recordPointerPosition(renderer, { x: event.event.x, y: event.event.y });
          if (event.event.type === "down" && event.event.button === MouseButton.LEFT) {
            currentPress = ++nextPress;
            primaryPointerPressed.set(renderer, true);
            reports.push({ type: "down", x: event.event.x, y: event.event.y, press: currentPress });
          } else if (
            event.event.type === "up" &&
            (event.event.button === MouseButton.LEFT || event.event.button === 3)
          ) {
            primaryPointerPressed.set(renderer, false);
            reports.push({ type: "up", x: event.event.x, y: event.event.y, press: currentPress });
            currentPress = undefined;
          }
          renderer.requestRender();
        }
      });
    }
    // Observe the batch before native dispatch; callbacks consume reports in dispatch order.
    renderer.stdin.prependListener("data", handleData);
    observer = {
      users: 0,
      dispose() {
        disposed = true;
        renderer.stdin.off("data", handleData);
        parser.destroy();
        pointerPositions.delete(renderer);
        primaryPointerPressed.delete(renderer);
        pointerPressReports.delete(renderer);
        pointerObservers.delete(renderer);
      },
    };
    pointerObservers.set(renderer, observer);
  }
  const current = observer;
  current.users++;
  return () => {
    current.users--;
    if (current.users === 0) {
      current.dispose();
    }
  };
}

export function usePointerObservation(): void {
  const renderer = useRenderer();
  useLayoutEffect(() => observePointer(renderer), [renderer]);
}
