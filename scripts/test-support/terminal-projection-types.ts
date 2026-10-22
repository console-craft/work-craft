/** Test-only material values: no native handles, glyph IDs or context-local link IDs. */
export type MaterialCell = {
  text: string;
  width: 0 | 1 | 2;
  fg: readonly [number, number, number, number];
  bg: readonly [number, number, number, number];
  attributes: number;
  link?: string;
};

export type MaterialFrame = {
  size: { cols: number; rows: number };
  rows: MaterialCell[][];
  cursor: {
    x: number;
    y: number;
    visible: boolean;
    style: "block" | "bar" | "underline" | "block-hollow";
    blinking: boolean;
  };
};

export type SemanticInput =
  | {
      kind: "key";
      key: {
        action?: "release" | "press" | "repeat";
        key?: string;
        mods?: number;
        consumedMods?: number;
        composing?: boolean;
        text?: string;
        unshiftedCodepoint?: number;
      };
    }
  | {
      kind: "mouse";
      mouse: {
        action: "press" | "release" | "motion";
        button?: "unknown" | "left" | "right" | "middle" | "four" | "five" | "six" | "seven";
        mods?: number;
        x: number;
        y: number;
        anyButtonPressed?: boolean;
      };
    }
  | { kind: "paste"; bytes: number[] }
  | { kind: "focus"; focused: boolean };
