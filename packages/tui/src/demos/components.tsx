import type { ReactNode } from "react";

import { CardsDemo } from "@/demos/cards-demo";
import { CommandsDemo } from "@/demos/commands-demo";
import { DemoPage } from "@/demos/demo-page";
import { DialogsDemo } from "@/demos/dialogs-demo";
import { DisclosureDemo } from "@/demos/disclosure-demo";
import { EmptyStateDemo } from "@/demos/empty-state-demo";
import { AlertsDemo, BadgesDemo, ProgressDemo, SpinnersDemo } from "@/demos/feedback-demo";
import { FieldDemo } from "@/demos/field-demo";
import { HorizontalScrollerDemo } from "@/demos/horizontal-scroller-demo";
import { ListDemo } from "@/demos/list-demo";
import { MenusDemo } from "@/demos/menus-demo";
import { TableDemo } from "@/demos/table-demo";
import { TabsDemo } from "@/demos/tabs-demo";
import { ToastDemo } from "@/demos/toast-demo";
import { useDemoTheme } from "@/demos/use-demo-theme";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";

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
