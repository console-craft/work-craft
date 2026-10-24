import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { sharedWait, startSharedSessionFixture } from "@/tests/support/shared-session-processes";

// oxlint-disable-next-line no-restricted-imports -- Existing test-only real stream input helper.
import { sendTerminalInput } from "../../../../../scripts/test-support/terminal-input";

export async function startCapacityProfile(
  directory: string,
  diagnostics = false,
): Promise<{
  fixture: Awaited<ReturnType<typeof startSharedSessionFixture>>;
  programPaneIds: string[];
  idlePaneIds: string[];
}> {
  const fixture = await startSharedSessionFixture({
    boundedObservation: true,
    profileDirectory: diagnostics ? directory : "",
  });
  const programPaneIds: string[] = [];
  const idlePaneIds: string[] = [];
  let control: Awaited<ReturnType<typeof fixture.client.stream>> | undefined;
  try {
    control = await fixture.client.stream({ onMessage() {} });
    await fixture.resizeTui(fixture.tuis[0], 200, 60);
    await fixture.resizeTui(fixture.tuis[1], 180, 55);
    for (let item = 0; item < 10; item++) {
      let paneId = fixture.paneId;
      let surfaceId = (await fixture.client.snapshot()).panes.find(
        (pane) => pane.id === paneId,
      )!.surfaceId;
      if (item > 0) {
        const path = join(fixture.home, `coding-${item}`);
        await mkdir(path);
        const registered = await fixture.client.command({
          type: "directory.register",
          workspaceId: fixture.workspaceId,
          path,
        });
        const opened = await fixture.client.command({
          type: "surface.ensure",
          itemId: registered.result.itemId!,
        });
        paneId = opened.result.paneId!;
        surfaceId = opened.result.surfaceId!;
      }
      const split = await fixture.client.command({
        type: "pane.split",
        paneId,
        direction: "vertical",
      });
      const firstPair = [paneId, split.result.paneId!];
      (item < 5 ? programPaneIds : idlePaneIds).push(...firstPair);
      const second = await fixture.client.command({
        type: "tab.create",
        surfaceId,
        title: "Second",
      });
      const secondSplit = await fixture.client.command({
        type: "pane.split",
        paneId: second.result.paneId!,
        direction: "vertical",
      });
      const third = await fixture.client.command({ type: "tab.create", surfaceId, title: "Third" });
      idlePaneIds.push(second.result.paneId!, secondSplit.result.paneId!, third.result.paneId!);
    }
    const program = join(import.meta.dir, "output-profile-program.ts");
    for (const [label, paneId] of programPaneIds.entries()) {
      await sendTerminalInput(
        fixture.client,
        control,
        paneId,
        new TextEncoder().encode(
          `exec '${process.execPath}' '${program}' '${directory}' '${label}'\r`,
        ),
      );
      await sharedWait(
        () => Bun.file(join(directory, `ready-profile-${label}.json`)).exists(),
        `complex producer ${label} starts`,
      );
    }
    await fixture.client.command({
      type: "session.navigate",
      sessionId: fixture.sessionId,
      target: { kind: "pane", paneId: programPaneIds[0]! },
    });
    control.close();
    return { fixture, programPaneIds, idlePaneIds };
  } catch (error) {
    control?.close();
    await fixture.close();
    throw error;
  }
}
