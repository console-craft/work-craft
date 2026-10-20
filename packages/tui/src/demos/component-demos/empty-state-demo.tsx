import { type ReactNode } from "react";

import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
} from "@/ui/components/empty-state";
import { Button } from "@/ui/controls/button";
import { symbols } from "@/ui/icons/symbols";
import { HStack } from "@/ui/primitives/hstack";
import { Icon } from "@/ui/primitives/icon";
import { Text } from "@/ui/primitives/text";

export function EmptyStateDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">EMPTY STATE</Text>
      <HStack gap={4}>
        <EmptyState>
          <EmptyStateIcon>{symbols.checkHeavy}</EmptyStateIcon>
          <EmptyStateTitle>No notifications</EmptyStateTitle>
          <EmptyStateDescription>You're all caught up.</EmptyStateDescription>
        </EmptyState>

        <EmptyState>
          <EmptyStateIcon>
            <Icon name="folderOpen" fg="mutedForeground" />
          </EmptyStateIcon>
          <EmptyStateTitle>No projects yet</EmptyStateTitle>
          <EmptyStateDescription>Create your first project to get started.</EmptyStateDescription>
          <EmptyStateActions>
            <Button>Create project</Button>
            <Button variant="secondary">Import</Button>
          </EmptyStateActions>
        </EmptyState>
      </HStack>
    </>
  );
}
