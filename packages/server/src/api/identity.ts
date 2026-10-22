/** This branch speaks material/semantic terminal projection, not fork-backed raw replay. */
export const TERMINAL_PROTOCOL = "work-craft-projection-preview/1";

export function assertTerminalProtocol(protocol: unknown): void {
  if (protocol !== TERMINAL_PROTOCOL) {
    throw new Error(
      `Incompatible daemon: expected ${TERMINAL_PROTOCOL}; use a separate WORK_CRAFT_HOME`,
    );
  }
}
