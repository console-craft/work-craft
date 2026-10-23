import { expect, spyOn, test } from "bun:test";

import { killSharedProcessGroup } from "@/tests/support/shared-session-processes";

test("shared process cleanup confirms disappearance after a transient denied probe", async () => {
  const calls: [number, string | number | undefined][] = [];
  const kill = spyOn(process, "kill").mockImplementation((pid, signal) => {
    calls.push([pid, signal]);
    throw Object.assign(new Error("group exiting"), {
      code: calls.length < 3 ? "EPERM" : "ESRCH",
    });
  });
  try {
    await killSharedProcessGroup(12345);
    expect(calls).toEqual([
      [-12345, "SIGKILL"],
      [-12345, 0],
      [-12345, 0],
    ]);
  } finally {
    kill.mockRestore();
  }
});

for (const scenario of [
  { name: "kills an owned group", kill: null, probe: null, fails: false, signals: ["SIGKILL"] },
  {
    name: "accepts a group already gone",
    kill: "ESRCH",
    probe: null,
    fails: false,
    signals: ["SIGKILL"],
  },
  {
    name: "accepts a group gone after a denied kill",
    kill: "EPERM",
    probe: "ESRCH",
    fails: false,
    signals: ["SIGKILL", 0],
  },
  {
    name: "rejects a denied kill when the group still exists",
    kill: "EPERM",
    probe: null,
    fails: true,
    signals: ["SIGKILL", 0],
  },
  {
    name: "preserves permission failures from an uninspectable group",
    kill: "EPERM",
    probe: "EPERM",
    fails: true,
    signals: ["SIGKILL", 0],
  },
  {
    name: "does not mistake a probe failure for absence",
    kill: "EPERM",
    probe: "EIO",
    fails: true,
    signals: ["SIGKILL", 0],
  },
  {
    name: "preserves unrelated kill failures",
    kill: "EIO",
    probe: null,
    fails: true,
    signals: ["SIGKILL"],
  },
] as const) {
  test(`shared process cleanup ${scenario.name}`, async () => {
    const failure = Object.assign(new Error("kill failed"), { code: scenario.kill });
    const calls: [number, string | number | undefined][] = [];
    const kill = spyOn(process, "kill").mockImplementation((pid, signal) => {
      calls.push([pid, signal]);
      const code = signal === 0 ? scenario.probe : scenario.kill;
      if (code !== null) {
        throw signal === 0 ? Object.assign(new Error("probe failed"), { code }) : failure;
      }
      return true;
    });
    try {
      if (scenario.fails) {
        await expect(killSharedProcessGroup(12345)).rejects.toThrow(failure);
      } else {
        await expect(killSharedProcessGroup(12345)).resolves.toBeUndefined();
      }
      if (scenario.probe === "EPERM") {
        expect(calls[0]).toEqual([-12345, "SIGKILL"]);
        expect(calls.length).toBeGreaterThan(1);
        expect(calls.slice(1).every(([pid, signal]) => pid === -12345 && signal === 0)).toBe(true);
      } else {
        expect(calls).toEqual(scenario.signals.map((signal) => [-12345, signal]));
      }
    } finally {
      kill.mockRestore();
    }
  });
}
