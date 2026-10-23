import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createClient,
  TERMINAL_PROTOCOL,
  type TerminalProjectionContext,
} from "../packages/server/src/client";
import { configurePreviewEnvironment } from "../src/preview-environment";
import { runPreview, stopPreview } from "./preview-command";
import { seedPreview } from "./seed-preview";

/** Relocated compiled daemon + real PTY regression, not a manual/performance evaluation. */
export async function smokePreview(source: string): Promise<void> {
  configurePreviewEnvironment({ ...process.env });
  const directory = await mkdtemp(join(tmpdir(), "wc-pv-"));
  const install = join(directory, "installation with spaces");
  const executable = join(install, "work-craft-preview");
  const home = join(directory, "s");
  await mkdir(install);
  await copyFile(source, executable);
  await chmod(executable, 0o755);
  let daemonPid: number | undefined;
  try {
    const seed = await seedPreview({ home, executable, cwd: install, reset: false });
    await runPreview(executable, home, ["daemon", "status", "--json"]);
    const client = createClient({ socketPath: join(home, "work-craft.sock") });
    const health = await client.health();
    daemonPid = health.pid;
    assert.equal(health.protocol, TERMINAL_PROTOCOL);
    const sessionId = seed.snapshot.sessions[0]!.id;
    const paneId = seed.examplePaneId;
    const initialHistory = (await client.snapshot()).terminalHistories.find(
      (history) => history.paneId === paneId,
    )!;
    const initialSeparators =
      Buffer.from(initialHistory.data, "base64")
        .toString()
        .split("daemon restarted; shell restored").length - 1;
    for (let recovery = 0; recovery < 2; recovery++) {
      const stream = await client.stream({ onMessage() {} }, { snapshot: "control" });
      try {
        const attachment = await stream.attach(sessionId);
        const selected = await client.snapshot();
        const navigation = selected.navigation.find((cursor) => cursor.sessionId === sessionId)!;
        const stamp = {
          epoch: selected.epoch,
          attachmentGeneration: attachment.generation,
          navigationGeneration: navigation.generation,
          geometrySequence: selected.geometry.tabs.find((tab) => tab.tabId === navigation.tabId)!
            .generation,
        };
        stream.reportViewport(
          { ...stamp, tabId: navigation.tabId!, canvas: { cols: 120, rows: 40 }, eligible: true },
          stamp,
        );
        await stream.command(
          { type: "session.navigate", sessionId, target: { kind: "pane", paneId } },
          attachment.generation,
        );
        const snapshot = await client.snapshot();
        const runtimeGeneration = (await client.controlSnapshot()).terminalStates.find(
          (state) => state.paneId === paneId,
        )!.runtimeGeneration;
        const context: TerminalProjectionContext = {
          ...stamp,
          geometrySequence: snapshot.geometry.tabs.find((tab) => tab.tabId === navigation.tabId)!
            .generation,
          runtimeGeneration,
        };
        async function waitForText(expected: string, scrollOffset = 0): Promise<void> {
          const deadline = Date.now() + 4000;
          let text = "";
          do {
            const material = await stream.requestMaterial(paneId, context, scrollOffset);
            text = material.frame.rows
              .map((row) =>
                row.map(([count, value, width]) => (width ? value.repeat(count) : "")).join(""),
              )
              .join("\n");
            if (text.includes(expected)) {
              return;
            }
            await Bun.sleep(20);
          } while (Date.now() < deadline);
          throw new Error(`Compiled material missing ${expected}: ${text}`);
        }
        if (recovery === 0) {
          await waitForText("Regional indicators");
        } else {
          await waitForText("daemon restarted; shell restored");
          await waitForText("COMPILED-079-42");
          await waitForText("COMPILED-000-42", 65);
          const retained = (await client.snapshot()).terminalHistories.find(
            (history) => history.paneId === paneId,
          )!;
          assert.equal(
            Buffer.from(retained.data, "base64")
              .toString()
              .split("daemon restarted; shell restored").length - 1,
            initialSeparators + 1,
          );
        }
        await stream.sendSemantic(
          paneId,
          { kind: "paste", bytes: new TextEncoder().encode("printf 'PREVIEW-%s\\n' STOCK") },
          { ...context, source: "input", kind: "paste", activitySequence: 1 },
        );
        const result = await stream.sendSemantic(
          paneId,
          { kind: "key", key: { key: "enter" } },
          { ...context, source: "input", kind: "key", activitySequence: 2 },
        );
        assert.equal(result.forwarded, true);
        await waitForText("PREVIEW-STOCK");
        if (recovery === 0) {
          await stream.sendSemantic(
            paneId,
            {
              kind: "paste",
              bytes: new TextEncoder().encode(
                'i=0; while [ "$i" -lt 80 ]; do printf \'COMPILED-%03d-%s\\n\' "$i" "$((6*7))"; i=$((i+1)); done',
              ),
            },
            { ...context, source: "input", kind: "paste", activitySequence: 3 },
          );
          await stream.sendSemantic(
            paneId,
            { kind: "key", key: { key: "enter" } },
            { ...context, source: "input", kind: "key", activitySequence: 4 },
          );
          await waitForText("COMPILED-079-42");
        }
      } finally {
        stream.close();
      }
      if (recovery === 0) {
        await stopPreview(executable, home);
        // The seeded demo clears its screen on every start; this owned recovery fixture uses a plain shell.
        const db = new Database(join(home, "work-craft.sqlite"));
        try {
          db.query("UPDATE panes SET restore_policy_json = ? WHERE id = ?").run(
            JSON.stringify({ type: "shell", executable: "/bin/sh", args: ["-i"] }),
            paneId,
          );
        } finally {
          db.close();
        }
        await runPreview(executable, home, ["daemon", "status", "--json"]);
        const restarted = await client.health();
        assert.notEqual(restarted.pid, daemonPid);
        assert.notEqual(restarted.epoch, health.epoch);
        daemonPid = restarted.pid;
      }
    }
    console.log(
      "Relocated stock preview: protocol, example, cold scrollback recovery, fresh semantic paste/key and shell output verified.",
    );
  } finally {
    await stopPreview(executable, home);
    assert(!existsSync(join(home, "work-craft.sock")) && !existsSync(join(home, "daemon.lock")));
    if (daemonPid !== undefined) {
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        try {
          process.kill(daemonPid, 0);
        } catch {
          daemonPid = undefined;
          break;
        }
        await Bun.sleep(10);
      }
      assert.equal(
        daemonPid,
        undefined,
        "Owned preview daemon survived shutdown; preserve diagnostic home",
      );
    }
    await rm(directory, { recursive: true });
  }
}

if (import.meta.main) {
  await smokePreview(resolve(process.argv[2] ?? "dist/work-craft-preview"));
}
