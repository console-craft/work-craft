import type { ReactNode } from "react";

import { escapeLabel } from "@/navigation/path-label.ts";
import { DialogClose, DialogFooter, DialogHeader, DialogTitle } from "@/ui/components/dialog";
import { Button } from "@/ui/controls/button";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export function ArchivePrompt({
  title,
  path,
  onConfirm,
}: {
  title: string;
  path: string;
  onConfirm(): void;
}): ReactNode {
  return (
    <Stack>
      <DialogHeader>
        <DialogTitle>Archive {escapeLabel(title)}?</DialogTitle>
      </DialogHeader>
      <Text>{escapeLabel(path)}</Text>
      <Text>Terminals keep running.</Text>
      <DialogFooter>
        <Button id="archive:confirm" onPress={onConfirm}>
          Archive
        </Button>
        <DialogClose id="dialog:cancel" variant="ghost">
          Cancel
        </DialogClose>
      </DialogFooter>
    </Stack>
  );
}
