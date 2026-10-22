import type {
  CompactMaterialFrame,
  SemanticTerminalInput,
} from "../../packages/server/src/api/terminal-material";

export type {
  CompactMaterialFrame,
  MaterialCell,
  MaterialFrame,
} from "../../packages/server/src/api/terminal-material";
export type SemanticInput = SemanticTerminalInput;

/** Fixture identities only; production uses the real connection registry. */
export type ProjectionStamp = {
  epoch: string;
  runtime: string;
  attachment: number;
  navigation: number;
  geometry: number;
};
export type ProjectionEnvelope = {
  stamp: ProjectionStamp;
  sequence: number;
  frame: CompactMaterialFrame;
};
export type ProjectionInput = { stamp: ProjectionStamp; input: SemanticInput };
export type PasteMessage = { id: string; stamp: ProjectionStamp } & (
  | { type: "paste.begin"; total: number }
  | { type: "paste.chunk"; offset: number; data: string }
  | { type: "paste.commit" }
  | { type: "paste.cancel" }
);
