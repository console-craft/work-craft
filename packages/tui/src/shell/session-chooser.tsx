import type { Snapshot } from "@work-craft/server/client";
import type { ReactNode } from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/components/command";
import { DialogClose, DialogFooter, DialogHeader, DialogTitle } from "@/ui/components/dialog";
import { Button } from "@/ui/controls/button";
import { Stack } from "@/ui/primitives/stack";

export type SessionChooserProps = {
  sessions: Snapshot["sessions"];
  canCancel: boolean;
  onSelect(sessionId: string): void;
  onCreate(): void;
};

export function SessionChooser({
  canCancel,
  sessions,
  onSelect,
  onCreate,
}: SessionChooserProps): ReactNode {
  const ordered = [...sessions].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  return (
    <Stack minHeight={0}>
      <DialogHeader flexShrink={0}>
        <DialogTitle>Sessions</DialogTitle>
      </DialogHeader>
      <Command direction="up" minHeight={0} flexShrink={1}>
        <CommandInput id="session:search" placeholder="Search sessions..." submitLabel="Attach" />
        <CommandList height={8} minHeight={0} flexShrink={1}>
          <CommandEmpty>
            {ordered.length === 0 ? "No sessions yet." : "No matching sessions."}
          </CommandEmpty>
          {ordered.map(({ id, name }) => (
            <CommandItem
              id={`session:item:${id}`}
              key={id}
              value={name}
              onSelect={() => onSelect(id)}
              marginRight={1}
            >
              {name}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
      <DialogFooter flexShrink={0}>
        <Button id="session:create" onPress={onCreate}>
          New session
        </Button>
        {canCancel ? (
          <DialogClose id="dialog:cancel" variant="ghost">
            Cancel
          </DialogClose>
        ) : null}
      </DialogFooter>
    </Stack>
  );
}
