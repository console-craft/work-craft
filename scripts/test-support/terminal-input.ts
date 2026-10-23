import type { StreamConnection, WorkCraftClient } from "../../packages/server/src/client.ts";

const activity = new WeakMap<StreamConnection, number>();

/** Real test/smoke clients attach, select and acknowledge a viewport before typing. */
export async function sendTerminalInput(
  client: WorkCraftClient,
  stream: StreamConnection,
  paneId: string,
  bytes: Uint8Array,
): Promise<void> {
  const initial = await client.snapshot();
  const sessionId = initial.sessions[0]!.id;
  const attachment = await stream.attach(sessionId);
  await stream.command(
    { type: "session.navigate", sessionId, target: { kind: "pane", paneId } },
    attachment.generation,
  );
  const selected = await client.snapshot();
  const navigation = selected.navigation.find((cursor) => cursor.sessionId === sessionId)!;
  const stamp = {
    epoch: selected.epoch,
    attachmentGeneration: attachment.generation,
    navigationGeneration: navigation.generation,
    geometrySequence: selected.geometry.tabs.find(({ tabId }) => tabId === navigation.tabId)!
      .generation,
  };
  stream.reportViewport(
    { ...stamp, tabId: navigation.tabId!, canvas: { cols: 120, rows: 40 }, eligible: true },
    stamp,
  );
  // This no-op RPC is an ordered transport barrier, not a timing sleep.
  await stream.command(
    { type: "session.navigate", sessionId, target: { kind: "pane", paneId } },
    attachment.generation,
  );
  const synchronized = await client.snapshot();
  const sequence = (activity.get(stream) ?? 0) + 1;
  activity.set(stream, sequence);
  stream.sendInput(paneId, bytes, {
    ...stamp,
    geometrySequence: synchronized.geometry.tabs.find(({ tabId }) => tabId === navigation.tabId)!
      .generation,
    source: "input",
    kind: "key",
    activitySequence: sequence,
  });
}
