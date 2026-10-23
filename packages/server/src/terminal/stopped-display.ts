import type { TerminalSize } from "../api/protocol";
import type { CompactMaterialFrame } from "../api/terminal-material";
import type { TerminalProjection } from "./projection";

export type StoppedDisplayKey = {
  paneId: string;
  runtimeGeneration: number;
  cursor: number;
  gridSequence: number | null;
  size: TerminalSize;
};
type Display = Pick<TerminalProjection, "frame" | "destroy">;
type Reader = {
  offset: number;
  current(): boolean;
  resolve(frame: CompactMaterialFrame): void;
  reject(error: unknown): void;
};
type ReadGroup = {
  key: StoppedDisplayKey;
  id: string;
  build(): Promise<Display>;
  readers: Reader[];
  invalid: boolean;
};
type Job = { run(): Promise<void>; cancel(): void };

/** One display-only cache and a finite lane shared with runtime history preparation. */
export class StoppedDisplay {
  private entry?: { id: string; paneId: string; display: Display };
  private readonly reads = new Map<string, ReadGroup>();
  private readonly queue: Job[] = [];
  private active?: Promise<void>;
  private clearing?: Promise<void>;
  private pending = 0;

  read(
    key: StoppedDisplayKey,
    scrollOffset: number,
    build: () => Promise<Display>,
    isCurrent: () => boolean,
  ): Promise<CompactMaterialFrame> {
    if (!Number.isSafeInteger(scrollOffset) || scrollOffset < 0) {
      return Promise.reject(new Error("Invalid scroll offset"));
    }
    if (this.clearing || this.pending >= 128) {
      return Promise.reject(new Error("Stopped display request limit or shutdown"));
    }
    const id = JSON.stringify([
      key.paneId,
      key.runtimeGeneration,
      key.cursor,
      key.gridSequence,
      key.size.cols,
      key.size.rows,
    ]);
    return new Promise((resolve, reject) => {
      this.pending++;
      let group = this.reads.get(id);
      if (group && !group.invalid) {
        group.readers.push({ offset: scrollOffset, current: isCurrent, resolve, reject });
        return;
      }
      group = {
        key,
        id,
        build,
        readers: [{ offset: scrollOffset, current: isCurrent, resolve, reject }],
        invalid: false,
      };
      this.reads.set(id, group);
      const captured = group;
      this.queue.push({
        run: () => this.readGroup(captured),
        cancel: () => this.finish(captured, new Error("Stopped display shutdown")),
      });
      this.pump();
    });
  }

  prepare<T>(work: () => Promise<T>): Promise<T> {
    if (this.clearing || this.pending >= 128) {
      return Promise.reject(new Error("Stopped display request limit or shutdown"));
    }
    this.pending++;
    return new Promise((resolve, reject) => {
      this.queue.push({
        run: async () => {
          try {
            this.drop();
            resolve(await work());
          } catch (error) {
            reject(error);
          } finally {
            this.pending--;
          }
        },
        cancel: () => {
          this.pending--;
          reject(new Error("Stopped display shutdown"));
        },
      });
      this.pump();
    });
  }

  invalidate(paneId: string): void {
    for (const group of this.reads.values()) {
      if (group.key.paneId === paneId) {
        group.invalid = true;
      }
    }
    if (this.entry?.paneId === paneId) {
      this.drop();
    }
  }

  clear(): Promise<void> {
    if (this.clearing) {
      return this.clearing;
    }
    for (const group of this.reads.values()) {
      group.invalid = true;
    }
    for (const job of this.queue.splice(0)) {
      job.cancel();
    }
    this.drop();
    this.clearing = Promise.resolve(this.active).finally(() => {
      this.clearing = undefined;
    });
    return this.clearing;
  }

  private pump(): void {
    if (this.active || this.clearing) {
      return;
    }
    const job = this.queue.shift();
    if (job) {
      this.active = job.run().finally(() => {
        this.active = undefined;
        this.pump();
      });
    }
  }

  private drop(): void {
    const entry = this.entry;
    this.entry = undefined;
    entry?.display.destroy();
  }

  private finish(group: ReadGroup, error?: unknown): void {
    if (error) {
      for (const reader of group.readers) {
        reader.reject(error);
      }
    }
    this.pending -= group.readers.length;
    if (this.reads.get(group.id) === group) {
      this.reads.delete(group.id);
    }
  }

  private async readGroup(group: ReadGroup): Promise<void> {
    let built: Display | undefined;
    try {
      if (group.invalid || !group.readers.some((reader) => reader.current())) {
        throw new Error("Obsolete stopped display read");
      }
      if (this.entry?.id !== group.id) {
        this.drop();
        built = await group.build();
        if (group.invalid || !group.readers.some((reader) => reader.current())) {
          throw new Error("Obsolete stopped display construction");
        }
        this.entry = { id: group.id, paneId: group.key.paneId, display: built };
        built = undefined;
      }
      for (const reader of group.readers) {
        if (group.invalid || !reader.current()) {
          reader.reject(new Error("Obsolete stopped display read"));
        } else {
          const frame = this.entry!.display.frame(reader.offset);
          reader.resolve({ ...frame, cursor: { ...frame.cursor, visible: false } });
        }
      }
      this.finish(group);
    } catch (error) {
      built?.destroy();
      this.drop();
      this.finish(group, error);
    }
  }
}
