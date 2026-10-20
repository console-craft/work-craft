import { type ReactNode } from "react";

import { Alert, AlertContent, AlertDescription, AlertTitle } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/ui/components/card";
import { Progress } from "@/ui/components/progress";
import { Spinner } from "@/ui/components/spinner";
import { Button } from "@/ui/controls/button";
import { symbols } from "@/ui/icons/symbols";
import { HStack } from "@/ui/primitives/hstack";
import { Icon } from "@/ui/primitives/icon";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { Wrap } from "@/ui/primitives/wrap";

export function BadgesDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">BADGES</Text>
      <HStack gap={1}>
        <Badge color="primary">v2.4.1</Badge>

        <Badge>Draft</Badge>

        <Badge color="muted">{404}</Badge>

        <Badge color="success">
          <Icon name="check" fg="primaryForeground" />
          <Text fg="mutedForeground">Ready</Text>
        </Badge>

        <Badge color="warning">Pending</Badge>

        <Badge color="error" transform="uppercase">
          Failed
        </Badge>

        <Badge color="info">
          <Icon name="download" fg="mutedForeground" />
          <Text fg="primaryForeground">Update available...</Text>
        </Badge>
      </HStack>
    </>
  );
}
export function AlertsDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">ALERTS</Text>
      <Wrap alignItems="flex-start">
        <Alert status="info">
          <AlertContent>
            <AlertTitle>New version available</AlertTitle>
            <AlertDescription>Version 2.4.0 is ready to be installed.</AlertDescription>
          </AlertContent>
        </Alert>

        <Alert status="success">
          <AlertContent>
            <AlertTitle>Build completed</AlertTitle>
            <AlertDescription>All checks passed successfully.</AlertDescription>
          </AlertContent>
        </Alert>

        <Alert status="warning">
          <AlertContent>
            <AlertTitle>Configuration incomplete</AlertTitle>
          </AlertContent>
        </Alert>

        <Alert status="error">
          <AlertContent>
            <AlertTitle>Connection failed</AlertTitle>
          </AlertContent>
        </Alert>
      </Wrap>
    </>
  );
}
export function SpinnersDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">SPINNERS</Text>
      <HStack gap={4}>
        <Spinner />
        <Button disabled>
          <HStack>
            <Spinner color="primary" />
            <Text fg="mutedForeground">Saving...</Text>
          </HStack>
        </Button>
        <HStack>
          <Spinner color="focus" />
          <Text>Loading...</Text>
        </HStack>
      </HStack>
    </>
  );
}
export function ProgressDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">PROGRESS</Text>
      <HStack alignItems="flex-start" gap={2}>
        <Stack gap={1}>
          <Progress value={42} minWidth={40} maxWidth={60} />

          <Stack minWidth={40} maxWidth={60} gap={0}>
            <Text>Downloading packages</Text>
            <HStack gap={1}>
              <Progress flexShrink={1} value={37} max={52} color="focus" trackColor="secondary" />
              <Text width={5} marginLeft={1}>
                37/52
              </Text>
            </HStack>
          </Stack>

          <Progress
            minWidth={40}
            maxWidth={60}
            value={64}
            color="success"
            trackColor="focus"
            max={128}
            thin
          />
        </Stack>
        <Card minWidth={25} maxWidth={50} border={false} bg="secondary" gap={0}>
          <CardHeader paddingBottom={1}>
            <Progress value={8} max={10} trackColor="focus" thin />
            <CardTitle marginTop={1} fg="selection">
              System info
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
          </CardContent>
          <CardFooter justifyContent="space-between" paddingBottom={1} dividerColor="secondary">
            <Button variant="ghost">
              <Text fg="primary">{symbols.arrowLongLeft} Prev</Text>
            </Button>
            <Text fg="focus">8/10</Text>
            <Button variant="ghost">
              <Text fg="primary">Next {symbols.arrowLongRight}</Text>
            </Button>
          </CardFooter>
        </Card>
      </HStack>
    </>
  );
}
