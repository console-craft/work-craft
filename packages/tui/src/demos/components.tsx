import type { ReactNode } from "react";

import { CardsDemo } from "@/demos/component-demos/cards-demo";
import { CommandsDemo } from "@/demos/component-demos/commands-demo";
import { DialogsDemo } from "@/demos/component-demos/dialogs-demo";
import { DisclosureDemo } from "@/demos/component-demos/disclosure-demo";
import { EmptyStateDemo } from "@/demos/component-demos/empty-state-demo";
import {
  AlertsDemo,
  BadgesDemo,
  ProgressDemo,
  SpinnersDemo,
} from "@/demos/component-demos/feedback-demo";
import { FieldDemo } from "@/demos/component-demos/field-demo";
import { HorizontalScrollerDemo } from "@/demos/component-demos/horizontal-scroller-demo";
import { ListDemo } from "@/demos/component-demos/list-demo";
import { MenusDemo } from "@/demos/component-demos/menus-demo";
import { TableDemo } from "@/demos/component-demos/table-demo";
import { TabsDemo } from "@/demos/component-demos/tabs-demo";
import { ToastDemo } from "@/demos/component-demos/toast-demo";
import { DemoPage } from "@/demos/demo-page";
import { useDemoTheme } from "@/demos/use-demo-theme";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider, useTheme } from "@/ui/theming/theme-provider";

export function ComponentsDemo() {
  const theme = useDemoTheme();
  return (
    <ThemeProvider theme={theme}>
      <Content />
    </ThemeProvider>
  );
}

function Content(): ReactNode {
  const theme = useTheme();
  return (
    <DemoPage id="components-demo">
      <Text variant="muted">{`Theme: ${theme.name} · Ctrl+t to switch`}</Text>
      <CardsDemo />
      <BadgesDemo />
      <AlertsDemo />
      <SpinnersDemo />
      <ProgressDemo />
      <DisclosureDemo />
      <TabsDemo />
      <FieldDemo />
      <EmptyStateDemo />
      <DialogsDemo />
      <MenusDemo />
      <CommandsDemo />
      <ToastDemo />
      <Text fg="primary">TABLES</Text>
      <TableDemo />
      <ListDemo />
      <HorizontalScrollerDemo />
    </DemoPage>
  );
}
