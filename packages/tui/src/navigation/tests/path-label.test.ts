import { expect, test } from "bun:test";

import { escapeLabel, formatPathLabel } from "@/navigation/path-label.ts";

test("paths abbreviate only a true home prefix and preserve the basename where possible", () => {
  expect(formatPathLabel("/home/me/project", "/home/me", 80)).toBe("~/project");
  expect(formatPathLabel("/home/mer/project", "/home/me", 80)).toBe("/home/mer/project");
  expect(formatPathLabel("/long/intermediate/project", "/home/me", 14)).toBe("/l/i/project");
  expect(formatPathLabel("/", "/home/me", 1)).toBe("/");
});

test("labels escape controls and stay within cell width for Unicode and tiny bounds", () => {
  for (const path of [
    "/hello/世界/👩‍💻abc",
    "/é/combining",
    "/a\n\t\u001b[31m\u0085/b",
    "/verylongbasename",
  ]) {
    for (let width = 0; width < 30; width += 1) {
      const label = formatPathLabel(path, "/home", width);
      expect(label).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
      expect(Bun.stringWidth(label)).toBeLessThanOrEqual(width);
    }
  }
  expect(escapeLabel("a\nb")).toBe("a\\x0ab");
});
