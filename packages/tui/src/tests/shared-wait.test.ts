import { expect, spyOn, test } from "bun:test";

import { sharedWait } from "@/tests/support/shared-session-processes";

test("shared waits preserve the default cutoff and honor a longer explicit budget", async () => {
  const clock = spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(5000);
  try {
    await expect(sharedWait(() => true, "late completion")).rejects.toThrow(
      "Timed out waiting for late completion",
    );
    clock.mockReturnValueOnce(0).mockReturnValue(5000);
    await expect(
      sharedWait(
        () => true,
        "late completion",
        () => "",
        8000,
      ),
    ).resolves.toBeUndefined();
  } finally {
    clock.mockRestore();
  }
});
