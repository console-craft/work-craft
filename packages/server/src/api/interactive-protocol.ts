import {
  type InputStamp,
  type InteractiveMessage,
  ProtocolError,
  type TerminalInputContext,
  type ViewerReport,
} from "./protocol.ts";
import { parseTerminalProjectionRequest } from "./terminal-projection-protocol";

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError("interactive message must be an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProtocolError("interactive identity must be a nonblank string");
  }
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new ProtocolError("interactive sequence must be a safe integer");
  }
  return value as number;
}

function stamp(value: unknown): InputStamp {
  const input = object(value);
  return {
    epoch: text(input.epoch),
    attachmentGeneration: integer(input.attachmentGeneration),
    navigationGeneration: integer(input.navigationGeneration),
    geometrySequence: integer(input.geometrySequence),
  };
}

function viewer(value: unknown): ViewerReport | null {
  if (value === null) {
    return null;
  }
  const input = object(value);
  const canvas = object(input.canvas);
  const cols = integer(canvas.cols, 1);
  const rows = integer(canvas.rows, 1);
  if (
    cols > 4096 ||
    rows > 4096 ||
    cols * rows > 1_048_576 ||
    typeof input.eligible !== "boolean"
  ) {
    throw new ProtocolError("invalid canvas dimensions or eligibility");
  }
  return {
    epoch: text(input.epoch),
    attachmentGeneration: integer(input.attachmentGeneration),
    navigationGeneration: integer(input.navigationGeneration),
    tabId: text(input.tabId),
    canvas: { cols, rows },
    eligible: input.eligible,
  };
}

/** Parse the session-bound stream independently until the coordinated protocol cutover. */
export function parseInteractiveMessage(value: unknown): InteractiveMessage {
  const input = object(value);
  switch (input.type) {
    case "terminal.material":
    case "terminal.semantic":
    case "terminal.paste":
      return parseTerminalProjectionRequest(input);
    case "client.attach":
      return {
        type: input.type,
        requestId: integer(input.requestId, 1),
        sessionId: input.sessionId === null ? null : text(input.sessionId),
      };
    case "client.command":
      return {
        type: input.type,
        requestId: integer(input.requestId, 1),
        attachmentGeneration: integer(input.attachmentGeneration),
        command: input.command,
      };
    case "client.viewport":
      return { type: input.type, stamp: stamp(input.stamp), report: viewer(input.report) };
    case "client.activity":
      return { type: input.type, stamp: stamp(input.stamp), sequence: integer(input.sequence, 1) };
    case "terminal.input": {
      const context = object(input.context);
      let parsed: TerminalInputContext;
      if (context.source === "response") {
        parsed = { ...stamp(context), source: "response" };
      } else if (
        context.source === "input" &&
        ["key", "paste", "mouse", "focus"].includes(context.kind as string)
      ) {
        parsed = {
          ...stamp(context),
          source: "input",
          kind: context.kind as "key" | "paste" | "mouse" | "focus",
          ...(context.activitySequence === undefined
            ? {}
            : { activitySequence: integer(context.activitySequence, 1) }),
        };
      } else {
        throw new ProtocolError("invalid terminal input source");
      }
      if (context.runtimeGeneration !== undefined) {
        parsed.runtimeGeneration = integer(context.runtimeGeneration);
      }
      if (
        typeof input.data !== "string" ||
        Buffer.from(input.data, "base64").toString("base64") !== input.data
      ) {
        throw new ProtocolError("terminal input must be base64");
      }
      return { type: input.type, paneId: text(input.paneId), data: input.data, context: parsed };
    }
    default:
      throw new ProtocolError("unknown interactive message type");
  }
}
