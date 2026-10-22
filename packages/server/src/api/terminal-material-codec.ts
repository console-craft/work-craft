import type { CompactMaterialFrame, MaterialCell, MaterialFrame } from "./terminal-material";

const limit = 8 * 1024 * 1024;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function fields(value: unknown, names: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid projection object");
  }
  for (const name of Object.keys(value)) {
    if (!names.includes(name)) {
      throw new Error("Unexpected projection field");
    }
  }
}

function geometry(size: MaterialFrame["size"], cursor: MaterialFrame["cursor"]): void {
  fields(size, ["cols", "rows"]);
  fields(cursor, ["x", "y", "visible", "blinking", "style"]);
  if (
    !size ||
    ![size.cols, size.rows].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 4096) ||
    size.cols * size.rows > 1048576 ||
    !cursor ||
    !Number.isSafeInteger(cursor.x) ||
    !Number.isSafeInteger(cursor.y) ||
    cursor.x < 0 ||
    cursor.y < 0 ||
    cursor.x >= size.cols ||
    cursor.y >= size.rows ||
    typeof cursor.visible !== "boolean" ||
    typeof cursor.blinking !== "boolean" ||
    !["block", "bar", "underline", "block-hollow"].includes(cursor.style)
  ) {
    throw new Error("Invalid projection geometry/cursor");
  }
}

function styleValue(style: CompactMaterialFrame["styles"][number]): void {
  fields(style, ["fg", "bg", "attributes"]);
  if (
    !style ||
    ![style.fg, style.bg].every(
      (color) =>
        Array.isArray(color) &&
        color.length === 4 &&
        color.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1),
    ) ||
    !Number.isSafeInteger(style.attributes) ||
    style.attributes < 0 ||
    style.attributes > 255
  ) {
    throw new Error("Invalid projection style");
  }
}

function budget(bytes: number): void {
  if (bytes > limit) {
    throw new Error("Projection frame budget");
  }
}

export function validateCompactFrame(value: unknown): CompactMaterialFrame {
  const frame = value as CompactMaterialFrame;
  if (!frame || typeof frame !== "object") {
    throw new Error("Invalid projection frame");
  }
  fields(frame, ["size", "cursor", "styles", "rows"]);
  geometry(frame.size, frame.cursor);
  if (
    !Array.isArray(frame.styles) ||
    frame.styles.length > frame.size.cols * frame.size.rows ||
    !Array.isArray(frame.rows) ||
    frame.rows.length !== frame.size.rows
  ) {
    throw new Error("Invalid projection rows/styles");
  }
  let retained = 0;
  let decoded = 0;
  for (const style of frame.styles) {
    styleValue(style);
    retained += Buffer.byteLength(JSON.stringify(style)) + 1;
    budget(retained);
  }
  for (const row of frame.rows) {
    if (!Array.isArray(row) || row.length > frame.size.cols) {
      throw new Error("Invalid projection row");
    }
    let columns = 0;
    let tail = false;
    for (const run of row) {
      if (!Array.isArray(run) || run.length !== 4) {
        throw new Error("Invalid projection run");
      }
      const [count, text, width, style] = run;
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > frame.size.cols - columns ||
        typeof text !== "string" ||
        ![0, 1, 2].includes(width) ||
        !Number.isSafeInteger(style) ||
        style < 0 ||
        style >= frame.styles.length
      ) {
        throw new Error("Invalid projection run");
      }
      decoded += Buffer.byteLength(text) * count;
      budget(decoded);
      if (
        // oxlint-disable-next-line no-control-regex -- Terminal control bytes are not drawable cell text.
        /[\x00-\x1f\x7f-\x9f]/.test(text) ||
        (width === 0 ? !tail || text !== "" || count !== 1 : tail || text === "") ||
        (width === 2 && count !== 1)
      ) {
        throw new Error("Invalid projection cell width/text");
      }
      if (width !== 0) {
        const segments = graphemes.segment(text)[Symbol.iterator]();
        segments.next();
        // The terminal gives a single regional indicator two slots, unlike row segmentation.
        const columns = /^\p{Regional_Indicator}$/u.test(text) ? 2 : Bun.stringWidth(text);
        if (!segments.next().done || columns !== width) {
          throw new Error("Projection cell text/width mismatch");
        }
      }
      tail = width === 2;
      columns += count;
      retained += Buffer.byteLength(JSON.stringify(run)) + 1;
      budget(retained);
    }
    if (columns !== frame.size.cols || tail) {
      throw new Error("Invalid projection row width");
    }
  }
  budget(Buffer.byteLength(JSON.stringify(frame)));
  return frame;
}

export function createCompactFrameBuilder(
  size: MaterialFrame["size"],
  cursor: MaterialFrame["cursor"],
): {
  addRow(cells: Iterable<MaterialCell>): void;
  finish(): CompactMaterialFrame;
} {
  geometry(size, cursor);
  const frame: CompactMaterialFrame = {
    size: { ...size },
    cursor: { ...cursor },
    styles: [],
    rows: [],
  };
  const styles = new Map<string, number>();
  let retained = 0;
  let decoded = 0;
  return {
    addRow(cells) {
      if (frame.rows.length >= size.rows) {
        throw new Error("Too many projection rows");
      }
      const row: CompactMaterialFrame["rows"][number] = [];
      let columns = 0;
      for (const cell of cells) {
        if (++columns > size.cols) {
          throw new Error("Invalid projection row width");
        }
        decoded += Buffer.byteLength(cell.text);
        budget(decoded);
        const style = { fg: cell.fg, bg: cell.bg, attributes: cell.attributes };
        const key = JSON.stringify(style);
        let index = styles.get(key);
        if (index === undefined) {
          retained += Buffer.byteLength(key) + 1;
          budget(retained);
          index = frame.styles.length;
          styles.set(key, index);
          frame.styles.push(style);
        }
        const last = row.at(-1);
        if (last && last[1] === cell.text && last[2] === cell.width && last[3] === index) {
          const oldDigits = String(last[0]).length;
          last[0]++;
          retained += String(last[0]).length - oldDigits;
        } else {
          const run: CompactMaterialFrame["rows"][number][number] = [
            1,
            cell.text,
            cell.width,
            index,
          ];
          retained += Buffer.byteLength(JSON.stringify(run)) + 1;
          budget(retained);
          row.push(run);
        }
      }
      if (columns !== size.cols) {
        throw new Error("Invalid projection row width");
      }
      frame.rows.push(row);
    },
    finish: () => validateCompactFrame(frame),
  };
}

export function compactFrame(frame: MaterialFrame): CompactMaterialFrame {
  const builder = createCompactFrameBuilder(frame.size, frame.cursor);
  for (const row of frame.rows) {
    builder.addRow(row);
  }
  return builder.finish();
}
