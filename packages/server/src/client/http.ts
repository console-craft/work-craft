import type { ValidationField } from "../api/protocol.ts";
import { observeOutput, outputProbeEnabled } from "../terminal/output-probe.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly field?: ValidationField,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requestJson(
  socketPath: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const started = outputProbeEnabled ? performance.now() : 0;
  const stage = path === "/control" ? "control" : path === "/snapshot" ? "snapshot" : null;
  if (outputProbeEnabled && stage) {
    observeOutput({ stage: `${stage}.fetch.start` });
  }
  const response = await fetch(`http://localhost${path}`, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(3_000)])
      : AbortSignal.timeout(3_000),
    unix: socketPath,
  });
  const body = await response.json();
  if (outputProbeEnabled && stage) {
    observeOutput({ stage: `${stage}.fetch.end`, durationMs: performance.now() - started });
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with status ${response.status}`;
    const field =
      typeof body === "object" &&
      body !== null &&
      "field" in body &&
      typeof body.field === "string" &&
      ["name", "title", "path"].includes(body.field)
        ? (body.field as ValidationField)
        : undefined;
    throw field === undefined ? new Error(message) : new ApiError(message, field);
  }
  return body;
}
