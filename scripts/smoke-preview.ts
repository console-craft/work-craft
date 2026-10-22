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
      async function waitForText(expected: string): Promise<void> {
        const deadline = Date.now() + 4000;
        let text = "";
        do {
          const material = await stream.requestMaterial(paneId, context, 0);
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
      await waitForText("Regional indicators");
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
    } finally {
      stream.close();
    }
    console.log(
      "Relocated stock preview: protocol, cold-launch example, real material, semantic paste/key and shell output verified.",
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
