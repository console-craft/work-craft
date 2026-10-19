/** Filenames are data: never allow them to add rows or terminal control sequences. */
export function escapeLabel(value: string): string {
  return value.replace(
    /[\x00-\x1f\x7f-\x9f]/g,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

export function homeRelativePath(path: string, homePath: string): string {
  return path === homePath
    ? "~"
    : homePath !== "/" && path.startsWith(`${homePath}/`)
      ? `~${path.slice(homePath.length)}`
      : path;
}

export function formatPathLabel(path: string, homePath: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  const parts = escapeLabel(homeRelativePath(path, homePath)).split("/");
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (
    let index = 0;
    index < parts.length - 1 && Bun.stringWidth(parts.join("/")) > width;
    index += 1
  ) {
    parts[index] = segmenter.segment(parts[index]!)[Symbol.iterator]().next().value?.segment ?? "";
  }
  const label = parts.join("/");
  if (Bun.stringWidth(label) <= width) {
    return label;
  }
  const basename = parts.at(-1)!;
  if (Bun.stringWidth(`…/${basename}`) <= width) {
    return `…/${basename}`;
  }
  let end = width - 1;
  let prefix = Bun.sliceAnsi(basename, 0, end);
  // Bun's ANSI slicer can include a wide grapheme crossing its end column.
  while (end > 0 && Bun.stringWidth(prefix) > width - 1) {
    prefix = Bun.sliceAnsi(basename, 0, --end);
  }
  return `${prefix}…`;
}
