import type { PaneStatus, TerminalSize } from "../api/protocol.ts";
import { STREAM_BACKPRESSURE_LIMIT } from "../api/protocol.ts";
import type { CompactMaterialFrame, SemanticTerminalInput } from "../api/terminal-material";
import { readProcessCwd, validateSplitCwd } from "./cwd.ts";
import { observeOutput, outputProbeEnabled } from "./output-probe.ts";
import { createTerminalProjection, type TerminalProjection } from "./projection";
import { resolveShellSpawn, type RuntimePane } from "./restore.ts";

export type RuntimeCallbacks = {
  onOutput(paneId: string, bytes: Uint8Array, runtimeGeneration: number): void;
  onStatus(paneId: string, status: PaneStatus, runtimeGeneration: number, error?: string): void;
};

type LiveRuntime = {
  terminal: Bun.Terminal;
  process: Bun.Subprocess;
  exited: Promise<number>;
  preserveStatus(): void;
  projection: {
    parser: TerminalProjection | null;
    sequence: number;
    frame?: CompactMaterialFrame;
    error?: Error;
  };
  pendingBytes: number;
  pendingInput?: {
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  };
};

type ProcessInfo = { pid: number; parentPid: number; startedAt: string };

function listProcesses(): ProcessInfo[] {
  const result = Bun.spawnSync(["ps", "-ax", "-o", "pid=,ppid=,lstart="], { stderr: "pipe" });
  if (!result.success) {
    throw new Error(`Could not inspect runtime processes: ${result.stderr.toString().trim()}`);
  }

  return result.stdout
    .toString()
    .split("\n")
    .flatMap((line): ProcessInfo[] => {
      const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line.trim());
      if (match === null) {
        return [];
      }
      const pid = Number(match[1]);
      const parentPid = Number(match[2]);
      return Number.isInteger(pid) && Number.isInteger(parentPid)
        ? [{ pid, parentPid, startedAt: match[3]! }]
        : [];
    });
}

function processTree(rootPid: number): ProcessInfo[] {
  const processes = listProcesses();
  const children = new Map<number, ProcessInfo[]>();
  for (const process of processes) {
    children.set(process.parentPid, [...(children.get(process.parentPid) ?? []), process]);
  }

  const root = processes.find(({ pid }) => pid === rootPid);
  if (root === undefined) {
    return [];
  }
  const tree = [root];
  for (let index = 0; index < tree.length; index += 1) {
    tree.push(...(children.get(tree[index]!.pid) ?? []));
  }
  return tree.reverse();
}

function survivingProcesses(expected: ProcessInfo[]): ProcessInfo[] {
  if (expected.length === 0) {
    return [];
  }
  const current = new Map(listProcesses().map((process) => [process.pid, process.startedAt]));
  return expected.filter(({ pid, startedAt }) => current.get(pid) === startedAt);
}

async function waitForProcesses(processes: ProcessInfo[]): Promise<ProcessInfo[]> {
  const deadline = Date.now() + 250;
  let survivors = survivingProcesses(processes);
  while (survivors.length > 0 && Date.now() < deadline) {
    await Bun.sleep(Math.min(10, deadline - Date.now()));
    survivors = survivingProcesses(survivors);
  }
  return survivors;
}

function signalProcesses(expected: ProcessInfo[], signal: NodeJS.Signals): void {
  for (const { pid } of survivingProcesses(expected)) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }
}

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, LiveRuntime>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly callbacks: RuntimeCallbacks) {}

  generation(paneId: string): number {
    return this.generations.get(paneId) ?? 0;
  }

  async start(pane: RuntimePane, size: TerminalSize = { cols: 80, rows: 24 }): Promise<void> {
    if (this.isLive(pane.id)) {
      throw new Error(`Pane already has a live runtime: ${pane.id}`);
    }

    const generation = this.generation(pane.id) + 1;
    this.generations.set(pane.id, generation);
    this.callbacks.onStatus(pane.id, "starting", generation);
    let terminal: Bun.Terminal | undefined;
    let runtime: LiveRuntime | undefined;
    let projection: LiveRuntime["projection"] | undefined;
    try {
      const spec = resolveShellSpawn(pane);
      projection = { parser: createTerminalProjection(size), sequence: 0 };
      const picture = projection;
      let resolveTerminalExit!: () => void;
      const terminalExit = new Promise<void>((resolve) => {
        resolveTerminalExit = resolve;
      });
      const process = Bun.spawn(spec.cmd, {
        cwd: spec.cwd,
        env: spec.env,
        terminal: {
          cols: size.cols,
          rows: size.rows,
          data: (_terminal, bytes) => {
            if (this.generation(pane.id) === generation) {
              try {
                picture.parser!.write(bytes);
                picture.sequence++;
                const replies = picture.parser!.replies();
                if (replies.length) {
                  if (runtime) {
                    this.write(pane.id, replies);
                  } else {
                    _terminal.write(replies);
                  }
                }
              } catch (error) {
                picture.error = error instanceof Error ? error : new Error(String(error));
              }
              this.callbacks.onOutput(pane.id, bytes, generation);
            }
          },
          drain: () => {
            if (runtime) {
              runtime.pendingBytes = 0;
              if (runtime.pendingInput) {
                clearTimeout(runtime.pendingInput.timer);
                runtime.pendingInput.resolve();
                runtime.pendingInput = undefined;
              }
            }
          },
          exit: resolveTerminalExit,
        },
      });
      const spawnedTerminal = (terminal = process.terminal!);
      let publishExit = true;
      const exited = process.exited.then(async (code) => {
        await terminalExit;
        await Bun.sleep(0);
        if (!spawnedTerminal.closed) {
          spawnedTerminal.close();
        }
        if (runtime?.pendingInput) {
          clearTimeout(runtime.pendingInput.timer);
          runtime.pendingInput.reject(new Error("Runtime exited during input"));
          runtime.pendingInput = undefined;
        }
        try {
          picture.frame = picture.parser!.frame(0);
        } catch (error) {
          picture.error = error instanceof Error ? error : new Error(String(error));
        } finally {
          picture.parser!.destroy();
          picture.parser = null;
        }
        if (publishExit && this.runtimes.get(pane.id) === runtime) {
          this.callbacks.onStatus(pane.id, "exited", generation);
        }
        return code;
      });
      runtime = {
        terminal: spawnedTerminal,
        process,
        exited,
        projection: picture,
        pendingBytes: 0,
        preserveStatus() {
          publishExit = false;
        },
      };
      this.runtimes.set(pane.id, runtime);
      this.callbacks.onStatus(pane.id, "running", generation);
    } catch (cause) {
      if (runtime === undefined) {
        terminal?.close();
        projection?.parser?.destroy();
      } else {
        runtime.preserveStatus();
        if (runtime.process.exitCode === null) {
          runtime.process.kill();
        }
        await runtime.exited;
      }
      this.runtimes.delete(pane.id);
      const error = cause instanceof Error ? cause.message : String(cause);
      this.callbacks.onStatus(pane.id, "failed", generation, error);
      throw cause;
    }
  }

  write(paneId: string, bytes: Uint8Array): void {
    if (outputProbeEnabled) {
      observeOutput({ stage: "input.forward", paneId, bytes: bytes.byteLength });
    }
    const runtime = this.liveRuntime(paneId);
    if (runtime.pendingBytes + bytes.byteLength + 128 > STREAM_BACKPRESSURE_LIMIT) {
      throw new Error("Terminal input pending byte limit");
    }
    runtime.pendingBytes += bytes.byteLength + 128;
    runtime.terminal.write(bytes);
  }

  resize(paneId: string, cols: number, rows: number): void {
    if (outputProbeEnabled) {
      observeOutput({ stage: "pty.resize", paneId, cols, rows });
    }
    const runtime = this.liveRuntime(paneId);
    runtime.projection.parser!.resize({ cols, rows });
    runtime.projection.sequence++;
    runtime.terminal.resize(cols, rows);
  }

  material(
    paneId: string,
    scrollOffset: number,
  ): { sequence: number; frame: CompactMaterialFrame } {
    const runtime = this.runtimes.get(paneId);
    if (!runtime) {
      throw new Error("Pane has no material");
    }
    const picture = runtime.projection;
    if (picture.error) {
      throw picture.error;
    }
    const frame = picture.parser?.frame(scrollOffset) ?? picture.frame;
    if (!frame) {
      throw new Error("Pane has no material");
    }
    return { sequence: picture.sequence, frame };
  }

  inputPending(paneId: string): boolean {
    return this.runtimes.get(paneId)?.pendingInput !== undefined;
  }

  async writeSemantic(paneId: string, input: SemanticTerminalInput | Uint8Array): Promise<boolean> {
    const runtime = this.liveRuntime(paneId);
    if (runtime.pendingInput) {
      throw new Error("Terminal input in flight");
    }
    if (runtime.projection.error) {
      throw runtime.projection.error;
    }
    const parser = runtime.projection.parser!;
    const bytes = input instanceof Uint8Array ? parser.encodePaste(input) : parser.encode(input);
    if (bytes.length === 0) {
      return false;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Terminal input drain timed out")), 4000);
      runtime.pendingInput = { resolve, reject, timer };
      try {
        this.write(paneId, bytes);
      } catch (error) {
        clearTimeout(timer);
        runtime.pendingInput = undefined;
        reject(error);
      }
    });
    return true;
  }

  /** Sample the owned process cwd without accepting a result from an exited/replaced runtime. */
  async currentDirectory(paneId: string): Promise<string> {
    const runtime = this.liveRuntime(paneId);
    const path = await validateSplitCwd(await readProcessCwd(runtime.process.pid));
    if (this.runtimes.get(paneId) !== runtime || !this.isLive(paneId)) {
      throw new Error(`Pane runtime changed during cwd inspection: ${paneId}`);
    }
    return path;
  }

  isLive(paneId: string): boolean {
    const process = this.runtimes.get(paneId)?.process;
    return process?.exitCode === null && process.signalCode === null;
  }

  waitForExit(paneId: string): Promise<number> {
    const runtime = this.runtimes.get(paneId);
    if (runtime === undefined) {
      throw new Error(`Pane has no runtime: ${paneId}`);
    }
    return runtime.exited;
  }

  async stopAll(options: { preserveStatus?: boolean } = {}): Promise<void> {
    const runtimes = [...this.runtimes.values()];
    const processTrees = new Map<LiveRuntime, ProcessInfo[]>();
    for (const runtime of runtimes) {
      if (runtime.process.exitCode === null) {
        processTrees.set(runtime, processTree(runtime.process.pid));
        if (options.preserveStatus) {
          runtime.preserveStatus();
        }
        signalProcesses(processTrees.get(runtime)!, "SIGTERM");
      }
    }
    const survivors = await waitForProcesses([...processTrees.values()].flat());
    signalProcesses(survivors, "SIGKILL");
    await Promise.all(runtimes.map(({ exited }) => exited));
    for (const runtime of runtimes) {
      runtime.projection.parser?.destroy();
    }
    this.runtimes.clear();
  }

  private liveRuntime(paneId: string): LiveRuntime {
    const runtime = this.runtimes.get(paneId);
    if (runtime === undefined || !this.isLive(paneId)) {
      throw new Error(`Pane has no live runtime: ${paneId}`);
    }
    return runtime;
  }
}
