type ProcessIdentity = { pid: number; startedAt: string };
type ObservedProcess = ProcessIdentity & { parent: number; command: string };

const OWNER_ENV = "WORK_CRAFT_TEST_RUN_ID";
// shortcut: detached fixtures must retain ownership; use OS isolation for uncooperative programs.

/** Preserve watchdog ownership when a fixture scrubs its ordinary environment. */
export function testProcessEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const owner = process.env[OWNER_ENV];
  return owner ? { ...env, [OWNER_ENV]: owner } : env;
}

function processTable(environment = false): Map<number, ObservedProcess> {
  const result = Bun.spawnSync(
    ["ps", ...(environment ? ["eww"] : []), "-axo", "pid=,ppid=,lstart=,command="],
    { env: { ...process.env, LC_ALL: "C" }, timeout: 1000, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.exitCode !== 0) {
    throw new Error("Cannot establish bounded-command process ownership");
  }
  const rows = new Map<number, ObservedProcess>();
  // Environment is inspected only for our opaque ownership marker; never log it.
  for (const line of result.stdout.toString().split("\n")) {
    const match = /^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line.trim());
    if (match) {
      const pid = Number(match[1]);
      rows.set(pid, {
        pid,
        parent: Number(match[2]),
        startedAt: match[3]!.replace(/\s+/g, " "),
        command: match[4]!,
      });
    }
  }
  if (!rows.size) {
    throw new Error("Cannot parse bounded-command process observation");
  }
  return rows;
}

/** Revalidate a captured birth before signalling; a reused PID is no longer ours. */
export function stopOwnedProcess(owned: ProcessIdentity): void {
  if (!Number.isSafeInteger(owned.pid) || owned.pid <= 1 || !owned.startedAt) {
    throw new Error("Invalid owned process identity");
  }
  const result = Bun.spawnSync(["ps", "-p", String(owned.pid), "-o", "lstart="], {
    env: { ...process.env, LC_ALL: "C" },
    timeout: 1000,
  });
  if (result.exitCode === 1 && !result.stdout.length && !result.stderr.length) {
    return;
  }
  if (result.exitCode !== 0) {
    throw new Error(`Cannot revalidate owned process ${owned.pid}`);
  }
  if (result.stdout.toString().trim().replace(/\s+/g, " ") !== owned.startedAt) {
    return;
  }
  try {
    process.kill(owned.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function captureDescendants(
  rows: Map<number, ObservedProcess>,
  owned: Map<number, ProcessIdentity>,
): void {
  for (let previous = -1; previous !== owned.size;) {
    previous = owned.size;
    for (const row of rows.values()) {
      const parent = owned.get(row.parent);
      if (parent && rows.get(parent.pid)?.startedAt === parent.startedAt) {
        owned.set(row.pid, row);
      }
    }
  }
}

async function cleanup(owned: Map<number, ProcessIdentity>, marker: string): Promise<void> {
  const deadline = Date.now() + 5000;
  do {
    const rows = processTable(true);
    for (const row of rows.values()) {
      if (` ${row.command} `.includes(` ${marker} `)) {
        owned.set(row.pid, row);
      }
    }
    captureDescendants(rows, owned);
    const remaining = [...owned.values()].filter(
      (entry) => rows.get(entry.pid)?.startedAt === entry.startedAt,
    );
    if (!remaining.length) {
      return;
    }
    for (const entry of remaining.reverse()) {
      stopOwnedProcess(entry);
    }
    await Bun.sleep(20);
  } while (Date.now() < deadline);
  throw new Error("Owned command processes survived cleanup; preserve fixture evidence");
}

function reap(child: Bun.Subprocess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Owned child exit could not be confirmed")),
      1000,
    );
    void child.exited.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** External watchdog: this parent must never import the native code it supervises. */
export async function runBounded(command: string[], timeoutMs: number): Promise<number> {
  if (!command.length || !command[0] || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Expected a command and a positive integer deadline in milliseconds");
  }
  const marker = `${OWNER_ENV}=${crypto.randomUUID()}`;
  const child = Bun.spawn(command, {
    detached: true,
    env: { ...process.env, [OWNER_ENV]: marker.slice(OWNER_ENV.length + 1) },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const owned = new Map<number, ProcessIdentity>();
  let finish!: (code: number) => void;
  const stopped = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const interrupt = () => finish(130);
  const terminate = () => finish(143);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  const timer = setTimeout(() => finish(124), timeoutMs);
  function observe(): void {
    const rows = processTable();
    const root = rows.get(child.pid);
    if (!root && child.exitCode === null) {
      throw new Error("Live child missing from process observation");
    }
    if (root && !owned.has(child.pid) && child.exitCode === null) {
      owned.set(child.pid, root);
    }
    captureDescendants(rows, owned);
  }
  const monitor = setInterval(() => {
    try {
      observe();
    } catch (error) {
      console.error(String(error));
      finish(1);
    }
  }, 250);
  let code = 1;
  try {
    observe();
    code = await Promise.race([child.exited, stopped]);
  } catch (error) {
    console.error(String(error));
  } finally {
    clearTimeout(timer);
    clearInterval(monitor);
    try {
      await cleanup(owned, marker);
    } catch (error) {
      console.error(String(error));
      code = 1;
    }
    try {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      await reap(child);
    } catch (error) {
      child.unref();
      console.error(String(error));
      code = 1;
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
  if (code === 124) {
    console.error(`External deadline exceeded (${timeoutMs} ms): ${command[0]}`);
  }
  return code;
}

if (import.meta.main) {
  const [deadline, ...command] = process.argv.slice(2);
  try {
    process.exitCode = await runBounded(command, Number(deadline));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
