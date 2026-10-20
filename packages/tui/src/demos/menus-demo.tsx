import { type ReactNode } from "react";

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/ui/components/menu";
import { HStack } from "@/ui/primitives/hstack";
import { Text } from "@/ui/primitives/text";

export function MenusDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">MENUS</Text>
      <HStack alignItems="flex-start">
        <Menu>
          <MenuTrigger variant="secondary">Actions</MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => console.log("Rename")}>Rename</MenuItem>
            <MenuItem onSelect={() => console.log("Duplicate")}>Duplicate</MenuItem>
            <MenuItem disabled>Archive</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => console.log("Delete")}>
              <Text variant="error">Delete</Text>
            </MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger variant="primary" width={60}>
            Custom
          </MenuTrigger>
          <MenuContent side="top" border={false} bg="secondary">
            <MenuItem onSelect={() => console.log("Rename")}>Rename</MenuItem>
            <MenuItem onSelect={() => console.log("Duplicate")}>Duplicate</MenuItem>
            <MenuItem disabled>Archive</MenuItem>
            <MenuSeparator borderColor="focus" />
            <MenuItem onSelect={() => console.log("Delete")}>
              <Text variant="error">Delete</Text>
            </MenuItem>
          </MenuContent>
        </Menu>
      </HStack>
    </>
  );
}
