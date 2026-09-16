import type { Database } from "bun:sqlite";
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createApp, type WorkCraftApp } from "./app.ts";
import { openDatabase } from "./database.ts";
import { startHttpServer } from "./http.ts";
import type { WorkCraftPaths } from "./paths.ts";

type FileIdentity = { dev: number | bigint; ino: number | bigint };
type Lock = { fd: number; identity: FileIdentity };

function fileIdentity(path: string): FileIdentity | undefined {
  try {
    const { dev, ino } = statSync(path, { bigint: true });
    return { dev, ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function sameFile(left: FileIdentity, right: FileIdentity | undefined): boolean {
  return right !== undefined && left.dev === right.dev && left.ino === right.ino;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lockPid(lockPath: string): number | undefined {
  try {
    const value = readFileSync(lockPath, "utf8").trim();
    if (!/^\d+$/.test(value)) {
      return undefined;
    }
    const pid = Number(value);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function createLock(lockPath: string): Lock {
  const fd = openSync(lockPath, "wx", 0o600);
  let identity: FileIdentity | undefined;
  try {
    const { dev, ino } = fstatSync(fd, { bigint: true });
    identity = { dev, ino };
    fchmodSync(fd, 0o600);
    writeSync(fd, `${process.pid}\n`);
    fsyncSync(fd);
    if (!sameFile(identity, fileIdentity(lockPath))) {
      throw new Error("Lost daemon lock ownership while publishing PID");
    }
    return { fd, identity };
  } catch (error) {
    closeSync(fd);
    if (identity === undefined) {
      rmSync(lockPath, { force: true });
    } else {
      removeOwned(lockPath, identity);
    }
    throw error;
  }
}

async function acquireLock(lockPath: string): Promise<Lock> {
  for (;;) {
    try {
      return createLock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    const pid = lockPid(lockPath);
    if (pid !== undefined && processIsAlive(pid)) {
      throw new Error(`Work Craft daemon is already starting or running (PID ${pid})`);
    }
    if (pid === undefined) {
      let age: number;
      try {
        age = Date.now() - statSync(lockPath).mtimeMs;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (age < 250) {
        // open("wx") makes the name visible just before the owner can write its PID.
        await Bun.sleep(Math.min(20, 250 - age));
        continue;
      }
    }

    const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
    try {
      renameSync(lockPath, stalePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    try {
      return createLock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    } finally {
      rmSync(stalePath, { force: true });
    }
  }
}

function removeOwned(path: string, identity: FileIdentity | undefined): void {
  if (identity !== undefined && sameFile(identity, fileIdentity(path))) {
    unlinkSync(path);
  }
}

async function socketIsHealthy(socketPath: string): Promise<boolean> {
  try {
    const response = await fetch("http://localhost/health", {
      unix: socketPath,
      signal: AbortSignal.timeout(250),
    });
    if (!response.ok) {
      return false;
    }
    const health = (await response.json()) as { pid?: unknown };
    return typeof health.pid === "number";
  } catch {
    return false;
  }
}

export async function runDaemon(paths: WorkCraftPaths): Promise<void> {
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  chmodSync(paths.stateDir, 0o700);

  let lock: Lock | undefined;
  let db: Database | undefined;
  let app: WorkCraftApp | undefined;
  let server: Bun.Server<undefined> | undefined;
  let socketIdentity: FileIdentity | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let startupComplete = false;
  let stopRequested = false;
  let resolveStopped!: () => void;
  let rejectStopped!: (error: unknown) => void;
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });

  const signalHandler = () => {
    stopRequested = true;
    if (startupComplete) {
      requestShutdown(false);
    }
  };

  function shutdown(drainStopRequest: boolean): Promise<void> {
    shutdownPromise ??= (async () => {
      let failure: unknown;
      async function attempt(action: () => void | Promise<void>): Promise<void> {
        try {
          await action();
        } catch (error) {
          failure ??= error;
        }
      }

      await attempt(async () => {
        if (server === undefined) {
          return;
        }
        if (!drainStopRequest) {
          await server.stop(true);
          return;
        }
        const stopped = server.stop(false);
        while (server.pendingRequests > 0) {
          await Bun.sleep(1);
        }
        await server.stop(true);
        await stopped;
      });
      await attempt(async () => app?.history.flush());
      await attempt(async () => app?.runtime.stopAll({ preserveStatus: true }));
      await attempt(async () => app?.history.close());
      await attempt(() => db?.close());
      await attempt(() => removeOwned(paths.socketPath, socketIdentity));
      await attempt(() => removeOwned(paths.lockPath, lock?.identity));
      await attempt(() => {
        if (lock !== undefined) {
          closeSync(lock.fd);
        }
      });
      process.off("SIGINT", signalHandler);
      process.off("SIGTERM", signalHandler);
      if (failure !== undefined) {
        throw failure;
      }
    })();
    return shutdownPromise;
  }

  function requestShutdown(drainStopRequest: boolean): void {
    void shutdown(drainStopRequest).then(resolveStopped, rejectStopped);
  }

  async function stopStartupIfRequested(): Promise<boolean> {
    if (!stopRequested) {
      return false;
    }
    await shutdown(false);
    return true;
  }

  try {
    process.on("SIGINT", signalHandler);
    process.on("SIGTERM", signalHandler);
    lock = await acquireLock(paths.lockPath);
    if (await stopStartupIfRequested()) {
      return;
    }
    if (existsSync(paths.socketPath)) {
      const healthy = await socketIsHealthy(paths.socketPath);
      if (await stopStartupIfRequested()) {
        return;
      }
      if (healthy) {
        throw new Error("A healthy Work Craft daemon already owns the Unix socket");
      }
      unlinkSync(paths.socketPath);
    }

    db = openDatabase(paths.databasePath);
    app = createApp({ db, onStop: () => requestShutdown(true) });
    await app.recover();
    if (await stopStartupIfRequested()) {
      return;
    }
    server = startHttpServer(app, paths.socketPath);
    socketIdentity = fileIdentity(paths.socketPath);
    startupComplete = true;
    if (stopRequested) {
      requestShutdown(false);
    }
    await stopped;
  } catch (error) {
    try {
      await shutdown(false);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Daemon startup and cleanup failed");
    }
    throw error;
  }
}
