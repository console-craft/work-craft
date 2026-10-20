import { type ReactNode } from "react";

import { Badge } from "@/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/components/card";
import { Button } from "@/ui/controls/button";
import { HStack } from "@/ui/primitives/hstack";
import { Icon } from "@/ui/primitives/icon";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { useTheme } from "@/ui/theming/theme-provider";

export function CardsDemo(): ReactNode {
  const theme = useTheme();
  return (
    <>
      <Text fg="primary">CARDS</Text>
      <HStack gap={1} alignItems="flex-start">
        <Card title="Project" titleColor={theme.colors.error} titleAlignment="center" flexGrow={1}>
          <CardContent marginTop={1}>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
            <Text>Prompt engineering is just arguing with probability distributions.</Text>
          </CardContent>
          <CardFooter justifyContent="flex-end">
            <Button variant="secondary">Cancel</Button>
            <Button variant="destructive">Delete</Button>
          </CardFooter>
        </Card>
        <Card flexGrow={1}>
          <CardHeader>
            <CardTitle>Project</CardTitle>
            <CardDescription>Current workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
            <Text>Prompt engineering is just arguing with probability distributions.</Text>
          </CardContent>
        </Card>
        <Card flexGrow={1} bg={theme.colors.secondary} border={false} paddingY={1}>
          <CardHeader>
            <HStack justifyContent="space-between">
              <CardTitle fg={theme.colors.accent} transform="uppercase">
                Project
              </CardTitle>
              <Badge color="muted">
                <Icon name="beaker" fg="primary" />
                <Text fg="mutedForeground">Lab</Text>
              </Badge>
            </HStack>
          </CardHeader>
          <CardContent>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
            <Text>Prompt engineering is just arguing with probability distributions.</Text>
          </CardContent>
          <CardFooter paddingTop={1} dividerColor={theme.colors.muted}>
            <Stack flexGrow={1}>
              <Button variant="primary">OK</Button>
              <Button bg={theme.colors.focus} fg={theme.colors.foreground}>
                Close
              </Button>
            </Stack>
          </CardFooter>
        </Card>
      </HStack>
    </>
  );
}
