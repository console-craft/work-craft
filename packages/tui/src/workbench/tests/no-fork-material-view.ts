import type { RenderContext } from "@opentui/core";

import { sameProjectionStamp } from "@/workbench/tests/no-fork-input-queue";
import { TerminalMaterialRenderable } from "@/workbench/tests/no-fork-positioned-material-view";

// oxlint-disable-next-line no-restricted-imports -- Synthetic identities stay in the fixture.
import type {
  CompactMaterialFrame,
  ProjectionEnvelope,
  ProjectionStamp,
  SemanticInput as SemanticTerminalInput,
} from "../../../../../scripts/test-support/terminal-projection-types";

export class NoForkMaterialView extends TerminalMaterialRenderable {
  private sequence = -1;
  private publisher?: { epoch: string; runtime: string };

  constructor(
    context: RenderContext,
    frame: CompactMaterialFrame,
    send?: (input: SemanticTerminalInput) => void,
    canSend?: () => boolean,
  ) {
    super(context, { frame, onInput: send, canInput: canSend });
  }

  setEnvelope(envelope: ProjectionEnvelope, current: ProjectionStamp): boolean {
    if (this.isDestroyed) {
      return false;
    }
    const samePublisher =
      this.publisher?.epoch === envelope.stamp.epoch &&
      this.publisher?.runtime === envelope.stamp.runtime;
    if (
      !sameProjectionStamp(envelope.stamp, current) ||
      (samePublisher && envelope.sequence <= this.sequence)
    ) {
      return false;
    }
    this.setFrame(envelope.frame);
    this.sequence = envelope.sequence;
    this.publisher = { epoch: envelope.stamp.epoch, runtime: envelope.stamp.runtime };
    return true;
  }
}
