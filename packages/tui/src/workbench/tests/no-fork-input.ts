import type { KeyEvent } from "@opentui/core";

// oxlint-disable-next-line no-restricted-imports -- Test-only semantic DTO.
import type { SemanticInput } from "../../../../../scripts/test-support/terminal-projection-types";

const namedKeys: Record<string, string> = {
  up: "arrow_up",
  down: "arrow_down",
  left: "arrow_left",
  right: "arrow_right",
  return: "enter",
  pageup: "page_up",
  pagedown: "page_down",
  capslock: "caps_lock",
  scrolllock: "scroll_lock",
  numlock: "num_lock",
  printscreen: "print_screen",
  clear: "numpad_begin",
  kpminus: "numpad_subtract",
  kpplus: "numpad_add",
  leftshift: "shift_left",
  rightshift: "shift_right",
  leftctrl: "control_left",
  rightctrl: "control_right",
  leftalt: "alt_left",
  rightalt: "alt_right",
  leftsuper: "meta_left",
  rightsuper: "meta_right",
};

/** App-owned translation of public events, not a copy of upstream's key normalizer. */
export function semanticKey(event: KeyEvent): SemanticInput {
  // oxlint-disable-next-line no-control-regex -- Distinguish text from terminal control sequences.
  const printable = event.sequence && !/[\x00-\x1f\x7f]/.test(event.sequence);
  const associated =
    // oxlint-disable-next-line no-control-regex -- Associated text is carried by public Kitty CSI-u events.
    event.source === "kitty" ? /^\x1b\[[\d:]+;[^;]*;([\d:]+)u$/.exec(event.raw)?.[1] : undefined;
  const text = associated
    ? String.fromCodePoint(...associated.split(":").map(Number))
    : printable
      ? event.sequence
      : undefined;
  const physical = event.baseCode === undefined ? event.name : String.fromCodePoint(event.baseCode);
  const keypad = event.name.startsWith("kp")
    ? `numpad_${event.name.slice(2).replace("pageup", "page_up").replace("pagedown", "page_down")}`
    : undefined;
  const key =
    namedKeys[event.name] ??
    keypad ??
    (/^[a-z0-9]$/i.test(physical)
      ? `key_${physical.toLowerCase()}`
      : /^[a-z][a-z_0-9]+$/.test(event.name)
        ? event.name
        : undefined);
  const mods =
    (event.shift ? 1 : 0) |
    (event.ctrl ? 2 : 0) |
    (event.meta || event.option ? 4 : 0) |
    (event.super ? 8 : 0) |
    (event.capsLock ? 16 : 0) |
    (event.numLock ? 32 : 0);
  return {
    kind: "key",
    key: {
      action: event.eventType === "release" ? "release" : event.repeated ? "repeat" : "press",
      key,
      mods,
      text,
      // baseCode identifies the physical/layout key above; this field is the primary codepoint.
      unshiftedCodepoint:
        Array.from(event.name).length === 1
          ? event.name.codePointAt(0)
          : printable && Array.from(event.sequence).length === 1
            ? event.sequence.codePointAt(0)
            : undefined,
    },
  };
}
