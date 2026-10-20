import { type ReactNode } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/components/command";
import { Dialog, DialogContent, DialogTrigger } from "@/ui/components/dialog";
import { HStack } from "@/ui/primitives/hstack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export function CommandsDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">COMMANDS</Text>
      <Stack width={60}>
        <Text variant="heading" textAlign="center">
          Welcome to Work-Craft!
        </Text>
        <Command border={true} padding={1}>
          <CommandInput placeholder="Choose an action to start..." />
          <CommandList height={15}>
            <CommandEmpty>No commands found.</CommandEmpty>
            <CommandGroup heading="Files">
              <CommandItem onSelect={() => console.log("New file")}>New file</CommandItem>
              <CommandItem onSelect={() => console.log("Open file")}>Open file</CommandItem>
              <CommandItem disabled>Sync</CommandItem>
            </CommandGroup>
            <CommandGroup heading="Git" marginTop={1}>
              <CommandItem value="Local repo" onSelect={() => console.log("Local repo")}>
                Add local repo
              </CommandItem>
              <CommandItem value="Clone repo" onSelect={() => console.log("Clone repo")}>
                Clone repo
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Sessions" marginTop={1}>
              <CommandItem onSelect={() => console.log("Last session")}>Last session</CommandItem>
              <CommandItem onSelect={() => console.log("Open session")}>Open session</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </Stack>
      <HStack>
        <Dialog>
          <DialogTrigger>Open file</DialogTrigger>
          <DialogContent initialFocusId="open-file" width="80%" maxWidth={120}>
            <Command width="100%">
              <CommandInput id="open-file" placeholder="Search files..." />
              <CommandList height={15} bg="secondary">
                <CommandEmpty>No commands found.</CommandEmpty>
                <CommandItem onSelect={() => console.log("Open file")}>app.tsx</CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  entrypoint.test.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>main.tsx</CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/accordion.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/alert.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/badge.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/card.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/collapsible.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/command.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/empty-state.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/dialog.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/field.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/list.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/menu.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/spinner.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/icons/emoji.ts
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/icons/nerd-font.ts
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/icons/symbols.ts
                </CommandItem>
              </CommandList>
            </Command>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger>Open file (up)</DialogTrigger>
          <DialogContent initialFocusId="open-file" width="80%" maxWidth={120}>
            <Command direction="up" width="100%">
              <CommandInput id="open-file" placeholder="Search files..." />
              <CommandList height={15} bg="secondary">
                <CommandEmpty>No commands found.</CommandEmpty>
                <CommandItem onSelect={() => console.log("Open file")}>app.tsx</CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  entrypoint.test.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>main.tsx</CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/accordion.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/alert.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/badge.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/card.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/collapsible.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/command.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/empty-state.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/dialog.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/field.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/list.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/menu.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/components/spinner.tsx
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/icons/emoji.ts
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/icons/nerd-font.ts
                </CommandItem>
                <CommandItem onSelect={() => console.log("Open file")}>
                  ui/icons/symbols.ts
                </CommandItem>
              </CommandList>
            </Command>
          </DialogContent>
        </Dialog>
      </HStack>
    </>
  );
}
