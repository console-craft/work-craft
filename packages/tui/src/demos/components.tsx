import { DemoPage } from "@/demos/demo-page";
import { useDemoTheme } from "@/demos/use-demo-theme";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/ui/components/accordion";
import { Alert, AlertContent, AlertDescription, AlertTitle } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/components/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/components/collapsible";
import { Progress } from "@/ui/components/progress";
import { Spinner } from "@/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Button } from "@/ui/controls/button";
import { symbols } from "@/ui/icons/symbols";
import { HStack } from "@/ui/primitives/hstack";
import { Icon } from "@/ui/primitives/icon";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { Wrap } from "@/ui/primitives/wrap";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";

export function ComponentsDemo() {
  const theme = useDemoTheme();
  return (
    <ThemeProvider theme={theme}>
      <Content />
    </ThemeProvider>
  );
}

/*
  1. Card - DONE
  2. Badge - DONE
  3. Alert - DONE
  4. Spinner - DONE
  5. Progress - DONE
  6. Collapsible - DONE
  7. Accordion - DONE
  8. Tabs - DONE
  9. Menu
  10. Dialog
  11. Command
  12. Toast
  13. List
  14. Table
  15. EmptyState
 */

function Content() {
  const theme = useTheme();
  const logs = [
    { id: 1, message: "Log 1" },
    { id: 2, message: "Log 2" },
    { id: 3, message: "Log 3" },
    { id: 4, message: "Log 4" },
    { id: 5, message: "Log 5" },
    { id: 6, message: "Log 6" },
    { id: 7, message: "Log 7" },
    { id: 8, message: "Log 8" },
    { id: 9, message: "Log 9" },
    { id: 10, message: "Log 10" },
    { id: 11, message: "Log 11" },
    { id: 12, message: "Log 12" },
    { id: 13, message: "Log 13" },
    { id: 14, message: "Log 14" },
    { id: 15, message: "Log 15" },
    { id: 16, message: "Log 16" },
    { id: 17, message: "Log 17" },
    { id: 18, message: "Log 18" },
    { id: 19, message: "Log 19" },
    { id: 20, message: "Log 20" },
    { id: 21, message: "Log 21" },
    { id: 22, message: "Log 22" },
    { id: 23, message: "Log 23" },
    { id: 24, message: "Log 24" },
    { id: 25, message: "Log 25" },
    { id: 26, message: "Log 26" },
    { id: 27, message: "Log 27" },
    { id: 28, message: "Log 28" },
    { id: 29, message: "Log 29" },
  ];
  return (
    <DemoPage id="components-demo">
      <Text variant="muted">{`Theme: ${theme.name} · Ctrl+t to switch`}</Text>
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

      <Text fg="primary">COLLAPSIBLE</Text>
      <Collapsible>
        <CollapsibleTrigger>Advanced settings</CollapsibleTrigger>
        <CollapsibleContent paddingLeft={3}>
          <Text>Timeout: 30s</Text>
          <Text>Retries: 3</Text>
        </CollapsibleContent>
      </Collapsible>

      <Text fg="primary">ACCORDIONS</Text>
      <Accordion defaultValue="general" width={40}>
        <AccordionItem value="general">
          <AccordionTrigger>General</AccordionTrigger>
          <AccordionContent>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
            <Text>Prompt engineering is just arguing with probability distributions.</Text>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="appearance">
          <AccordionTrigger>Appearance</AccordionTrigger>
          <AccordionContent>
            <ScrollArea focusable height={10} paddingRight={2}>
              <Stack>
                <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
                <Text>Prompt engineering is just arguing with probability distributions.</Text>
                <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
                <Text>Prompt engineering is just arguing with probability distributions.</Text>
                <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
                <Text>Prompt engineering is just arguing with probability distributions.</Text>
              </Stack>
            </ScrollArea>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="experimental" disabled>
          <AccordionTrigger>Experimental</AccordionTrigger>
          <AccordionContent>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
            <Text>Prompt engineering is just arguing with probability distributions.</Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Text fg="primary">TABS</Text>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger disabled value="logs">
            Logs
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Text>Project overview</Text>
        </TabsContent>
        <TabsContent value="projects">
          <Text>Projects list</Text>
        </TabsContent>
        <TabsContent value="logs">
          <Text>Application logs</Text>
        </TabsContent>
        <TabsContent value="settings">
          <Text>Project settings</Text>
        </TabsContent>
      </Tabs>
      <Card width={60} height={20} gap={0} bg="secondary" border={false} padding={0}>
        <CardContent paddingX={0} flexGrow={1} minHeight={0}>
          <Tabs defaultValue="overview" flexGrow={1}>
            <TabsList>
              <TabsTrigger
                value="overview"
                bg="accent"
                flexGrow={1}
                flexBasis={0}
                justifyContent="center"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="logs"
                bg="accent"
                flexGrow={1}
                flexBasis={0}
                justifyContent="center"
              >
                Logs
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                bg="accent"
                flexGrow={1}
                flexBasis={0}
                justifyContent="center"
              >
                Settings
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" paddingX={1}>
              <Text>Status: healthy</Text>
              <Text>Branch: main</Text>
            </TabsContent>
            <TabsContent value="logs" flexGrow={1} minHeight={0}>
              <ScrollArea focusable flexGrow={1} minHeight={0} paddingX={1}>
                {logs.map((log) => (
                  <Text key={log.id}>{log.message}</Text>
                ))}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="settings" paddingX={1}>
              <Text>Coming soon</Text>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </DemoPage>
  );
}
