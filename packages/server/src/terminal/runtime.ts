import type { PaneStatus, TerminalSize } from "../api/protocol.ts";
import { readProcessCwd, validateSplitCwd } from "./cwd.ts";
import { observeOutput, outputProbeEnabled } from "./output-probe.ts";
import { resolveShellSpawn, type RuntimePane } from "./restore.ts";

export type RuntimeCallbacks = {
  onOutput(paneId: string, bytes: Uint8Array): void;
  onStatus(paneId: string, status: PaneStatus, error?: string): void;
};

type LiveRuntime = {
  terminal: Bun.Terminal;
  process: Bun.Subprocess;
  exited: Promise<number>;
  preserveStatus(): void;
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

  constructor(private readonly callbacks: RuntimeCallbacks) {}

  async start(pane: RuntimePane, size: TerminalSize = { cols: 80, rows: 24 }): Promise<void> {
    if (this.isLive(pane.id)) {
      throw new Error(`Pane already has a live runtime: ${pane.id}`);
    }

    this.callbacks.onStatus(pane.id, "starting");
    let terminal: Bun.Terminal | undefined;
    let runtime: LiveRuntime | undefined;
    try {
      const spec = resolveShellSpawn(pane);
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
          data: (_terminal, bytes) => this.callbacks.onOutput(pane.id, bytes),
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
        if (publishExit && this.runtimes.get(pane.id) === runtime) {
          this.callbacks.onStatus(pane.id, "exited");
        }
        return code;
      });
      runtime = {
        terminal: spawnedTerminal,
        process,
        exited,
        preserveStatus() {
          publishExit = false;
        },
      };
      this.runtimes.set(pane.id, runtime);
      this.callbacks.onStatus(pane.id, "running");
    } catch (cause) {
      if (runtime === undefined) {
        terminal?.close();
      } else {
        runtime.preserveStatus();
        if (runtime.process.exitCode === null) {
          runtime.process.kill();
        }
        await runtime.exited;
      }
      this.runtimes.delete(pane.id);
      const error = cause instanceof Error ? cause.message : String(cause);
      this.callbacks.onStatus(pane.id, "failed", error);
      throw cause;
    }
  }

  write(paneId: string, bytes: Uint8Array): void {
    if (outputProbeEnabled) {
      observeOutput({ stage: "input.forward", paneId, bytes: bytes.byteLength });
    }
    this.liveRuntime(paneId).terminal.write(bytes);
  }

  resize(paneId: string, cols: number, rows: number): void {
    if (outputProbeEnabled) {
      observeOutput({ stage: "pty.resize", paneId, cols, rows });
    }
    this.liveRuntime(paneId).terminal.resize(cols, rows);
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
