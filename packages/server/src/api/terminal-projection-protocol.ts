import {
  type InputStamp,
  ProtocolError,
  STREAM_BACKPRESSURE_LIMIT,
  type TerminalInputContext,
} from "./protocol";
import type { CompactMaterialFrame, SemanticTerminalInput } from "./terminal-material";

export type TerminalProjectionContext = InputStamp & { runtimeGeneration: number };
export type TerminalSemanticContext = TerminalProjectionContext &
  Extract<TerminalInputContext, { source: "input" }>;
export type TerminalPasteTransfer = { id: string } & (
  | { operation: "begin"; total: number }
  | { operation: "chunk"; offset: number; data: string }
  | { operation: "commit" | "cancel" }
);
export type TerminalProjectionPayload = { paneId: string } & (
  | { type: "terminal.material"; context: TerminalProjectionContext; scrollOffset: number }
  | {
      type: "terminal.semantic";
      context: TerminalSemanticContext;
      input: Exclude<SemanticTerminalInput, { kind: "paste" }>;
    }
  | { type: "terminal.paste"; context: TerminalSemanticContext; transfer: TerminalPasteTransfer }
);
export type TerminalProjectionRequest = TerminalProjectionPayload & { requestId: number };
export type TerminalMaterialResult = {
  paneId: string;
  context: TerminalProjectionContext;
  sequence: number;
  frame: CompactMaterialFrame;
};
export type TerminalProjectionReply =
  | { type: "terminal.material.result"; requestId: number; material: TerminalMaterialResult }
  | { type: "terminal.input.result"; requestId: number; forwarded: boolean }
  | { type: "terminal.error"; requestId: number; message: string };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("Invalid terminal projection object");
  }
  return value as Record<string, unknown>;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ProtocolError("Invalid terminal projection integer");
  }
  return value as number;
}
function text(value: unknown, max = 256, blank = false): string {
  if (
    typeof value !== "string" ||
    (!blank && value.trim() === "") ||
    Buffer.byteLength(value) > max
  ) {
    throw new ProtocolError("Invalid terminal projection text");
  }
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ProtocolError("Invalid terminal projection boolean");
  }
  return value;
}
function context(value: unknown): TerminalProjectionContext {
  const input = object(value);
  return {
    epoch: text(input.epoch),
    attachmentGeneration: integer(input.attachmentGeneration),
    navigationGeneration: integer(input.navigationGeneration),
    geometrySequence: integer(input.geometrySequence),
    runtimeGeneration: integer(input.runtimeGeneration),
  };
}
function semanticContext(
  value: unknown,
  kind: SemanticTerminalInput["kind"],
): TerminalSemanticContext {
  const input = object(value);
  if (input.source !== "input" || input.kind !== kind) {
    throw new ProtocolError("Invalid semantic input source/kind");
  }
  return {
    ...context(input),
    source: "input",
    kind,
    ...(input.activitySequence === undefined
      ? {}
      : { activitySequence: integer(input.activitySequence, Number.MAX_SAFE_INTEGER, 1) }),
  };
}
function semantic(value: unknown): Exclude<SemanticTerminalInput, { kind: "paste" }> {
  const input = object(value);
  if (input.kind === "focus") {
    return { kind: "focus", focused: boolean(input.focused) };
  }
  if (input.kind === "key") {
    const key = object(input.key);
    if (
      key.action !== undefined &&
      !["press", "release", "repeat"].includes(key.action as string)
    ) {
      throw new ProtocolError("Invalid key action");
    }
    return {
      kind: "key",
      key: {
        ...(key.key === undefined ? {} : { key: text(key.key) }),
        ...(key.text === undefined
          ? {}
          : { text: text(key.text, STREAM_BACKPRESSURE_LIMIT - 128, true) }),
        ...(key.action === undefined
          ? {}
          : { action: key.action as "press" | "release" | "repeat" }),
        ...(key.mods === undefined ? {} : { mods: integer(key.mods, 255) }),
        ...(key.consumedMods === undefined ? {} : { consumedMods: integer(key.consumedMods, 255) }),
        ...(key.composing === undefined ? {} : { composing: boolean(key.composing) }),
        ...(key.unshiftedCodepoint === undefined
          ? {}
          : { unshiftedCodepoint: integer(key.unshiftedCodepoint, 0x10ffff) }),
      },
    };
  }
  if (input.kind === "mouse") {
    const mouse = object(input.mouse);
    if (
      !Number.isFinite(mouse.x) ||
      !Number.isFinite(mouse.y) ||
      !["press", "release", "motion"].includes(mouse.action as string) ||
      (mouse.button !== undefined &&
        !["unknown", "left", "middle", "right", "four", "five", "six", "seven"].includes(
          mouse.button as string,
        ))
    ) {
      throw new ProtocolError("Invalid semantic mouse input");
    }
    return {
      kind: "mouse",
      mouse: {
        x: mouse.x as number,
        y: mouse.y as number,
        action: mouse.action as "press" | "release" | "motion",
        ...(mouse.button === undefined
          ? {}
          : {
              button: mouse.button as
                | "unknown"
                | "left"
                | "middle"
                | "right"
                | "four"
                | "five"
                | "six"
                | "seven",
            }),
        ...(mouse.mods === undefined ? {} : { mods: integer(mouse.mods, 63) }),
        ...(mouse.anyButtonPressed === undefined
          ? {}
          : { anyButtonPressed: boolean(mouse.anyButtonPressed) }),
      },
    };
  }
  throw new ProtocolError("Unsupported semantic input; paste requires chunked transport");
}

export function parseTerminalProjectionRequest(value: unknown): TerminalProjectionRequest {
  const input = object(value);
  const shared = {
    requestId: integer(input.requestId, Number.MAX_SAFE_INTEGER, 1),
    paneId: text(input.paneId),
  };
  if (input.type === "terminal.material") {
    return {
      ...shared,
      type: input.type,
      context: context(input.context),
      scrollOffset: integer(input.scrollOffset),
    };
  }
  if (input.type === "terminal.semantic") {
    const event = semantic(input.input);
    return {
      ...shared,
      type: input.type,
      context: semanticContext(input.context, event.kind),
      input: event,
    };
  }
  if (input.type === "terminal.paste") {
    const transfer = object(input.transfer);
    const id = text(transfer.id, 64);
    let parsed: TerminalPasteTransfer;
    switch (transfer.operation) {
      case "begin":
        parsed = {
          id,
          operation: "begin",
          total: integer(transfer.total, STREAM_BACKPRESSURE_LIMIT - 128),
        };
        break;
      case "chunk":
        parsed = {
          id,
          operation: "chunk",
          offset: integer(transfer.offset),
          data: text(transfer.data, 4 * Math.ceil(65536 / 3)),
        };
        break;
      case "commit":
      case "cancel":
        parsed = { id, operation: transfer.operation };
        break;
      default:
        throw new ProtocolError("Invalid paste operation");
    }
    return {
      ...shared,
      type: input.type,
      context: semanticContext(input.context, "paste"),
      transfer: parsed,
    };
  }
  throw new ProtocolError("Unknown terminal projection request");
}

export function sameTerminalContext(
  a: TerminalProjectionContext,
  b: TerminalProjectionContext,
): boolean {
  return (
    a.epoch === b.epoch &&
    a.attachmentGeneration === b.attachmentGeneration &&
    a.navigationGeneration === b.navigationGeneration &&
    a.geometrySequence === b.geometrySequence &&
    a.runtimeGeneration === b.runtimeGeneration
  );
}
