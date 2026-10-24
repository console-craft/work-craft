import { expect, test } from "bun:test";

import { extend } from "@opentui/react";
import type {
  CompactMaterialFrame,
  Snapshot,
  StreamConnection,
  TerminalMaterialResult,
  TerminalProjectionContext,
} from "@work-craft/server/client";
import { act, useState } from "react";

import { createTerminalOutputs } from "@/client/terminal-output";
import { streamFixture, terminalBufferFixture } from "@/tests/support/fixtures";
import { flushMeasured } from "@/tests/support/measured-render";
import { testRender } from "@/tests/support/render";
import { Box } from "@/ui/primitives/box";
import { ThemeProvider } from "@/ui/theming/theme-provider";
import { defaultTheme } from "@/ui/theming/themes/default";
import { TerminalMaterialRenderable } from "@/workbench/terminal-material";
import { TerminalViewport } from "@/workbench/terminal-viewport";

extend({ terminal: TerminalMaterialRenderable });
type PaneStatus = Snapshot["panes"][number]["processStatus"];

function picture(text: string, size = { cols: 80, rows: 24 }): CompactMaterialFrame {
  return {
    size,
    cursor: { x: text.length, y: 0, visible: true, style: "bar", blinking: false },
    styles: [{ fg: [1, 1, 1, 1], bg: [0, 0, 0, 1], attributes: 0 }],
    rows: [
      [...text]
        .map((char) => [1, char, 1, 0] as [number, string, 1, number])
        .concat([[size.cols - text.length, " ", 1, 0]]),
      ...Array.from({ length: size.rows - 1 }, () => [
        [size.cols, " ", 1, 0] as [number, string, 1, number],
      ]),
    ],
  };
}

async function viewport(initialStatus: PaneStatus = "running") {
  let browseAllowed = true;
  const context: TerminalProjectionContext = {
    epoch: "e",
    attachmentGeneration: 1,
    navigationGeneration: 2,
    geometrySequence: 3,
    runtimeGeneration: 4,
  };
  const requests: {
    context: TerminalProjectionContext;
    signal?: AbortSignal;
    resolve(value: TerminalMaterialResult): void;
  }[] = [];
  const inputs: string[] = [];
  const outputs = createTerminalOutputs(
    new Map([["p", terminalBufferFixture({ epoch: "e", runtimeGeneration: 4 })]]),
  );
  function connection(): StreamConnection {
    return streamFixture({
      requestMaterial: async (_paneId, captured, _scrollOffset, signal) =>
        new Promise((resolve) => {
          requests.push({ context: { ...captured }, signal, resolve });
        }),
      sendSemantic: async (_paneId, input) => {
        inputs.push(input.kind);
        return { forwarded: true };
      },
    });
  }
  let setConnection!: (connection: StreamConnection) => void;
  let setContext!: (context: TerminalProjectionContext) => void;
  let setStatus!: (status: PaneStatus) => void;
  function Fixture() {
    const [stream, updateConnection] = useState(connection);
    const [scope, updateContext] = useState(context);
    const [status, updateStatus] = useState(initialStatus);
    setStatus = updateStatus;
    setConnection = updateConnection;
    setContext = updateContext;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Box position="absolute" left={2} top={2} width={60} height={12} overflow="hidden">
          <TerminalViewport
            paneId="p"
            output={outputs.pane("p")}
            size={{ cols: 80, rows: 24 }}
            stream={stream}
            context={scope}
            inputEnabled
            focused
            processStatus={status}
            canBrowse={() => browseAllowed}
            canInput={() => status === "running"}
            captureInput={() => ({
              valid: () => true,
              send: (input, signal) =>
                stream.sendSemantic(
                  "p",
                  input,
                  { ...scope, source: "input", kind: input.kind },
                  signal,
                ),
            })}
            onReady={() => {}}
            onFocus={() => {}}
            onError={() => {}}
          />
        </Box>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 70, height: 20, exitOnCtrlC: false });
  async function flush(): Promise<void> {
    await flushMeasured(setup);
    await flushMeasured(setup);
  }
  await flush();
  function node(): TerminalMaterialRenderable {
    return setup.renderer.root.findDescendantById("terminal:p") as TerminalMaterialRenderable;
  }
  async function respond(
    index: number,
    text: string,
    size?: { cols: number; rows: number },
  ): Promise<void> {
    const request = requests[index]!;
    await act(async () =>
      request.resolve({
        paneId: "p",
        context: request.context,
        sequence: index + 1,
        frame: picture(text, size),
      }),
    );
    await flush();
  }
  return {
    ...setup,
    flush,
    respond,
    node,
    requests,
    context,
    inputs,
    connection,
    setConnection,
    setContext,
    setStatus,
    setBrowse: (allowed: boolean) => {
      browseAllowed = allowed;
    },
  };
}

test("status changes refresh idle material without granting starting or stopped child input", async () => {
  const setup = await viewport("starting");
  try {
    expect(setup.requests).toHaveLength(0);
    act(() => setup.setStatus("running"));
    await setup.flush();
    expect(setup.requests).toHaveLength(1);
    await setup.respond(0, "READY");
    act(() => setup.setStatus("exited"));
    await setup.flush();
    expect(setup.requests).toHaveLength(2);
    expect(setup.node().focusable).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("stopped scrolling covers enlarged viewport background without double-counting terminal events", async () => {
  const setup = await viewport("exited");
  try {
    await setup.respond(0, "SMALL", { cols: 20, rows: 5 });
    await act(async () => setup.mockInput.pressKeys(["\x1b[<64;50;12M"]));
    expect(setup.node().scrollOffset).toBe(1);
    await act(async () => setup.mockInput.pressKeys(["\x1b[<64;10;4M"]));
    expect(setup.node().scrollOffset).toBe(2);
    setup.setBrowse(false);
    await act(async () => setup.mockInput.pressKeys(["\x1b[<64;50;12M"]));
    expect(setup.node().scrollOffset).toBe(2);
    expect(setup.inputs).toEqual([]);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("idle material mount requests a current picture and becomes ready only after a rendered frame", async () => {
  const setup = await viewport();
  try {
    expect(setup.requests).toHaveLength(1);
    expect(setup.node().focusable).toBe(false);
    const request = setup.requests[0]!;
    await act(async () =>
      request.resolve({
        paneId: "p",
        context: request.context,
        sequence: 1,
        frame: picture("READY"),
      }),
    );
    expect(setup.node().focusable).toBe(false);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("READY");
    expect(setup.node().focusable).toBe(true);
    expect(setup.node().focused).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("same-scope idle reconnect aborts old material and cannot apply its late reply", async () => {
  const setup = await viewport();
  try {
    const old = setup.requests[0]!;
    act(() => setup.setConnection(setup.connection()));
    await setup.flush();
    expect(old.signal?.aborted).toBe(true);
    expect(setup.requests).toHaveLength(2);
    await setup.respond(0, "OBSOLETE");
    expect(setup.captureCharFrame()).not.toContain("OBSOLETE");
    expect(setup.node().focusable).toBe(false);
    await setup.respond(1, "CURRENT");
    expect(setup.captureCharFrame()).toContain("CURRENT");
    expect(setup.node().focusable).toBe(true);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("geometry replacement gates input and rejects a same-revision stale frame", async () => {
  const setup = await viewport();
  try {
    await setup.respond(0, "BEFORE");
    act(() => setup.setContext({ ...setup.context, geometrySequence: 4 }));
    await setup.flush();
    expect(setup.node().focused).toBe(true);
    await act(async () => setup.mockInput.pressKey("x"));
    expect(setup.inputs).not.toContain("key");
    const current = setup.requests.at(-1)!;
    await act(async () =>
      current.resolve({
        paneId: "p",
        context: setup.context,
        sequence: 999,
        frame: picture("STALE"),
      }),
    );
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("BEFORE");
    expect(setup.captureCharFrame()).not.toContain("STALE");
    expect(setup.node().focusable).toBe(false);
  } finally {
    act(() => setup.renderer.destroy());
  }
});
