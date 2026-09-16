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
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createApp, type WorkCraftApp } from "./app.ts";
import { openDatabase } from "./database.ts";
import { startHttpServer } from "./http.ts";
import type { WorkCraftPaths } from "./paths.ts";

type FileIdentity = { dev: number | bigint; ino: number | bigint };
type Lock = { fd: number; identity: FileIdentity };
type TakeoverClaim = Lock & { path: string };
type ClaimSnapshot = { path: string; identity: FileIdentity; publishedAt: bigint; pid?: number };
const HTTP_DRAIN_MS = 250;

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

function createLock(path: string, label = "daemon lock"): Lock {
  const fd = openSync(path, "wx", 0o600);
  let identity: FileIdentity | undefined;
  try {
    const { dev, ino } = fstatSync(fd, { bigint: true });
    identity = { dev, ino };
    fchmodSync(fd, 0o600);
    writeSync(fd, `${process.pid}\n`);
    fsyncSync(fd);
    if (!sameFile(identity, fileIdentity(path))) {
      throw new Error(`Lost ${label} ownership while publishing PID`);
    }
    return { fd, identity };
  } catch (error) {
    closeSync(fd);
    if (identity === undefined) {
      rmSync(path, { force: true });
    } else {
      removeOwned(path, identity);
    }
    throw error;
  }
}

function releaseOwned(path: string, owner: Lock): void {
  removeOwned(path, owner.identity);
  closeSync(owner.fd);
}

function takeoverClaims(prefix: string): ClaimSnapshot[] {
  const claims: ClaimSnapshot[] = [];
  for (const name of readdirSync(dirname(prefix))) {
    if (!name.startsWith(basename(prefix))) {
      continue;
    }

    const path = join(dirname(prefix), name);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const identity = { dev: stats.dev, ino: stats.ino };
    const pid = lockPid(path);
    if (!sameFile(identity, fileIdentity(path))) {
      continue;
    }
    if (pid !== undefined && processIsAlive(pid)) {
      claims.push({ path, identity, publishedAt: stats.mtimeNs, pid });
    } else if (pid === undefined && Date.now() - Number(stats.mtimeNs / 1_000_000n) < 250) {
      claims.push({ path, identity, publishedAt: stats.mtimeNs });
    } else {
      removeOwned(path, identity);
    }
  }

  // Filesystem publication time provides stable election order; the unique path breaks ties.
  return claims.sort((left, right) => {
    if (left.publishedAt !== right.publishedAt) {
      return left.publishedAt < right.publishedAt ? -1 : 1;
    }
    return left.path.localeCompare(right.path);
  });
}

async function waitForClaims(prefix: string, own?: TakeoverClaim): Promise<void> {
  const deadline = Date.now() + 1_000;
  for (;;) {
    const claims = takeoverClaims(prefix);
    if (own !== undefined && !sameFile(own.identity, fileIdentity(own.path))) {
      throw new Error("Lost daemon lock takeover claim ownership");
    }
    if (claims.length === 0 || claims[0]?.path === own?.path) {
      return;
    }
    if (Date.now() >= deadline) {
      const pid = claims[0]?.pid;
      if (pid === undefined) {
        throw new Error("Daemon lock takeover is already in progress");
      }
      throw new Error(`Daemon lock takeover is already in progress (PID ${pid})`);
    }
    await Bun.sleep(10);
  }
}

function createTakeoverClaim(prefix: string): TakeoverClaim {
  const path = `${prefix}${process.pid}-${crypto.randomUUID()}`;
  return { ...createLock(path, "daemon lock takeover claim"), path };
}

async function acquireLock(lockPath: string): Promise<Lock> {
  const takeoverPrefix = `${lockPath}.takeover-`;
  for (;;) {
    try {
      const lock = createLock(lockPath);
      try {
        await waitForClaims(takeoverPrefix);
        if (!sameFile(lock.identity, fileIdentity(lockPath))) {
          throw new Error("Lost daemon lock ownership during takeover");
        }
        return lock;
      } catch (error) {
        releaseOwned(lockPath, lock);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    const claim = createTakeoverClaim(takeoverPrefix);
    let lock: Lock | undefined;
    let stalePath: string | undefined;
    try {
      await waitForClaims(takeoverPrefix, claim);
      const identity = fileIdentity(lockPath);
      if (identity === undefined) {
        continue;
      }
      const pid = lockPid(lockPath);
      if (
        !sameFile(claim.identity, fileIdentity(claim.path)) ||
        !sameFile(identity, fileIdentity(lockPath))
      ) {
        continue;
      }
      if (pid !== undefined && processIsAlive(pid)) {
        throw new Error(`Work Craft daemon is already starting or running (PID ${pid})`);
      }
      if (pid === undefined && Date.now() - statSync(lockPath).mtimeMs < 250) {
        await Bun.sleep(20);
        continue;
      }

      stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
      renameSync(lockPath, stalePath);
      if (!sameFile(identity, fileIdentity(stalePath))) {
        continue;
      }
      lock = createLock(lockPath);
    } finally {
      if (stalePath !== undefined) {
        rmSync(stalePath, { force: true });
      }
      releaseOwned(claim.path, claim);
    }
    if (lock !== undefined) {
      try {
        await waitForClaims(takeoverPrefix);
      } catch (error) {
        releaseOwned(lockPath, lock);
        throw error;
      }
      if (!sameFile(lock.identity, fileIdentity(lockPath))) {
        releaseOwned(lockPath, lock);
        throw new Error("Lost daemon lock ownership after takeover");
      }
      return lock;
    }
  }
}

function removeOwned(path: string, identity: FileIdentity | undefined): void {
  try {
    if (identity !== undefined && sameFile(identity, fileIdentity(path))) {
      unlinkSync(path);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
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
  let forceShutdown = false;
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
    if (!drainStopRequest) {
      forceShutdown = true;
    }
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
        const deadline = Date.now() + HTTP_DRAIN_MS;
        while (server.pendingRequests > 0 && !forceShutdown && Date.now() < deadline) {
          await Bun.sleep(5);
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
    if (!sameFile(lock.identity, fileIdentity(paths.lockPath))) {
      throw new Error("Lost daemon lock ownership before startup");
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
