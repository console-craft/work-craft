import { type ReactNode, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/dialog";
import { HStack } from "@/ui/primitives/hstack";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export function DialogsDemo(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Text fg="primary">DIALOGS</Text>
      <HStack>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger width={20}>Open dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Project details</DialogTitle>
            </DialogHeader>
            <Stack gap={0}>
              <Text>Project: console-craft</Text>
              <Text>Rendering: OpenTUI</Text>
              <Text>Runtime: Bun</Text>
            </Stack>
            <DialogFooter justifyContent="center" marginBottom={1}>
              <DialogClose variant="primary">Close</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog destructive>
          <DialogTrigger id="destructive-dialog-trigger" width={28} variant="destructive">
            Destructive action
          </DialogTrigger>
          <DialogContent id="destructive-dialog-content" initialFocusId="destructive-dialog-cancel">
            <DialogHeader>
              <DialogTitle id="destructive-dialog-title">Delete project?</DialogTitle>
              <DialogDescription>This action cannot be undone.</DialogDescription>
            </DialogHeader>
            <Text>Are you sure you want to delete this project?</Text>
            <DialogFooter>
              <DialogClose id="destructive-dialog-cancel" variant="secondary">
                Cancel
              </DialogClose>
              <DialogClose id="destructive-dialog-continue" variant="destructive">
                Delete
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </HStack>
    </>
  );
}
