import type { PaneStatus } from "./protocol.ts";
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

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, LiveRuntime>();

  constructor(private readonly callbacks: RuntimeCallbacks) {}

  async start(pane: RuntimePane): Promise<void> {
    if (this.isLive(pane.id)) {
      throw new Error(`Pane already has a live runtime: ${pane.id}`);
    }

    this.callbacks.onStatus(pane.id, "starting");
    let terminal: Bun.Terminal | undefined;
    let runtime: LiveRuntime | undefined;
    try {
      const spec = resolveShellSpawn(pane);
      const spawnedTerminal = (terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
        data: (_terminal, bytes) => this.callbacks.onOutput(pane.id, bytes),
      }));
      const process = Bun.spawn(spec.cmd, {
        cwd: spec.cwd,
        env: spec.env,
        terminal: spawnedTerminal,
      });
      let publishExit = true;
      const exited = process.exited.then((code) => {
        spawnedTerminal.close();
        if (publishExit) {
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
    this.liveRuntime(paneId).terminal.write(bytes);
  }

  resize(paneId: string, cols: number, rows: number): void {
    this.liveRuntime(paneId).terminal.resize(cols, rows);
  }

  isLive(paneId: string): boolean {
    return this.runtimes.get(paneId)?.process.exitCode === null;
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
    for (const runtime of runtimes) {
      if (runtime.process.exitCode === null) {
        if (options.preserveStatus) {
          runtime.preserveStatus();
        }
        runtime.process.kill();
      }
    }
    await Promise.all(runtimes.map(({ exited }) => exited));
    this.runtimes.clear();
  }

  private liveRuntime(paneId: string): LiveRuntime {
    const runtime = this.runtimes.get(paneId);
    if (runtime === undefined || runtime.process.exitCode !== null) {
      throw new Error(`Pane has no live runtime: ${paneId}`);
    }
    return runtime;
  }
}
