export type OperationalError = {
  sourceKey: string;
  sourceLabel: string;
  operation: string;
  epoch: string;
  contextKey: string;
  requestId: number;
  message: string;
  expiresAt: number;
  origin: "direct" | "background";
};

export function reportOperationalError(
  current: OperationalError | null,
  next: OperationalError,
  now: number,
): OperationalError {
  return current !== null &&
    current.epoch === next.epoch &&
    current.expiresAt > now &&
    current.origin === "direct" &&
    next.origin === "background"
    ? current
    : next;
}

export function clearOperationalError(
  current: OperationalError | null,
  sourceKey: string,
  requestId: number,
): OperationalError | null {
  return current?.sourceKey === sourceKey && current.requestId === requestId ? null : current;
}

function safe(value: string): string {
  return value.replace(
    /[\x00-\x1f\x7f-\x9f]/g,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

export function statusPresentation(input: {
  leaderActive: boolean;
  invalidMessage: string | null;
  invalidMessageUntil: number | null;
  operationalError: OperationalError | null;
  now: number;
}): { mode: "HINTS" | "LEADER" | "ERROR"; text?: string } {
  if (input.leaderActive) {
    return { mode: "LEADER" };
  }
  if (input.invalidMessage !== null && (input.invalidMessageUntil ?? 0) > input.now) {
    return { mode: "ERROR", text: input.invalidMessage };
  }
  const error = input.operationalError;
  return error !== null && error.expiresAt > input.now
    ? {
        mode: "ERROR",
        text: `${safe(error.sourceLabel)} — ${safe(error.operation)} failed: ${safe(error.message)}`,
      }
    : { mode: "HINTS" };
}
