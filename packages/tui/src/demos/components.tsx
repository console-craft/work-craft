import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/components/command";
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
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
} from "@/ui/components/empty-state";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/ui/components/field";
import { List, ListItem } from "@/ui/components/list";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/ui/components/menu";
import { Progress } from "@/ui/components/progress";
import { Spinner } from "@/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Toaster } from "@/ui/components/toast";
import { Button } from "@/ui/controls/button";
import { Input } from "@/ui/controls/input";
import { useNativeFocus } from "@/ui/focus-manager";
import { symbols } from "@/ui/icons/symbols";
import { createNotificationStore } from "@/ui/notifications";
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
  9. Field - DONE
  10. EmptyState - DONE
  11. Dialog - DONE
  12. Menu - DONE
  13. Command - DONE
  14. Toast - DONE
  15. Table - DONE
   16. List - DONE
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

  function validateEmail(value: string) {
    const email = value.trim();

    if (!email) {
      return "Email is required.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Enter a valid email address.";
    }

    return undefined;
  }
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const error = submitted ? validateEmail(email) : undefined;

  function handleInput(value: string) {
    setEmail(value);
  }

  function handleSubmit() {
    setSubmitted(true);
  }

  const [open, setOpen] = useState(false);

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
      <Card
        id="card-tabs-demo"
        width={60}
        height={20}
        gap={0}
        bg="secondary"
        border={false}
        padding={0}
      >
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
      <Text fg="primary">FIELD</Text>
      <Stack width={40}>
        <Field>
          <FieldLabel>Name</FieldLabel>
          <FieldDescription>Used when displaying your profile.</FieldDescription>
          <Input placeholder="Enter username" width="100%" />
        </Field>

        <Field>
          <FieldLabel>Username</FieldLabel>
          <Input disabled value="john.doe" />
          <FieldDescription>Managed by your organization.</FieldDescription>
        </Field>

        <Field required invalid={Boolean(error)}>
          <FieldLabel>Email</FieldLabel>
          <Input
            value={email}
            onInput={handleInput}
            onSubmit={handleSubmit}
            placeholder="you@example.com"
            width="100%"
          />
          <FieldDescription>Used for account notifications.</FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>
      </Stack>

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
      <ToastDemo />

      <Text fg="primary">TABLES</Text>
      <TableDemo />
      <ListDemo />
    </DemoPage>
  );
}

function ListDemo() {
  const [query, setQuery] = useState("");
  const [listsDisabled, setListsDisabled] = useState(false);
  const [selected, setSelected] = useState("Architecture");
  const [active, setActive] = useState<string>();
  const [opens, setOpens] = useState(0);
  const focused = useNativeFocus()?.id === "list-entities" && !listsDisabled;
  const notes = [
    "Architecture",
    "Focus manager",
    "Keyboard shortcuts",
    "Theme tokens",
    "Rich rows",
    "Scrolling",
    "Filtering",
    "Native primitives",
    "Local daemon",
    "Projects",
    "Conversations",
    "Services",
    "Archived",
  ];
  const filtered = notes.filter((title) =>
    title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  return (
    <Stack gap={1} maxWidth={80}>
      <Text fg="primary">LISTS</Text>
      <Button
        id="list-toggle-disabled"
        variant="secondary"
        alignSelf="flex-start"
        onPress={() => setListsDisabled((value) => !value)}
      >
        {listsDisabled ? "Enable lists" : "Disable lists"}
      </Button>
      <List height={8} border defaultValue="projects" disabled={listsDisabled}>
        <ListItem value="notes">Notes</ListItem>
        <ListItem value="projects">Projects</ListItem>
        <ListItem value="services">Services</ListItem>
        <ListItem value="unavailable" disabled>
          Unavailable
        </ListItem>
      </List>
      <Input id="list-filter" value={query} onInput={setQuery} placeholder="Filter notes…" />
      <List
        id="list-entities"
        height={14}
        border
        disabled={listsDisabled}
        value={selected}
        onValueChange={setSelected}
        activeValue={active}
        onActiveValueChange={setActive}
        onActivate={() => setOpens((count) => count + 1)}
      >
        {filtered.map((title) => {
          const disabled = title === "Archived";
          const foreground =
            disabled || listsDisabled
              ? "mutedForeground"
              : focused && active === title && selected === title
                ? "primary"
                : focused && active === title
                  ? "focusForeground"
                  : selected === title
                    ? "primaryForeground"
                    : "foreground";
          return (
            <ListItem key={title} value={title} disabled={disabled}>
              <HStack width="100%" alignItems="center" gap={1}>
                <Icon name="file" fg={foreground} />
                <Stack flexGrow={1} minWidth={0} gap={0}>
                  <Text fg={foreground} truncate>
                    {title}
                  </Text>
                  <Text
                    fg={
                      selected === title || (focused && active === title)
                        ? foreground
                        : "mutedForeground"
                    }
                  >
                    {disabled ? "Read-only archive" : `Notes about ${title.toLocaleLowerCase()}`}
                  </Text>
                </Stack>
                <Text fg={foreground}>Today</Text>
              </HStack>
            </ListItem>
          );
        })}
        {filtered.length === 0 ? (
          <Text variant="muted" paddingX={1}>
            No matching notes
          </Text>
        ) : null}
      </List>
      <Text id="list-preview">{`Preview: ${active ?? "None"}`}</Text>
      <Text id="list-selected">{`Selected: ${selected}`}</Text>
      <Text id="list-open-count" variant="muted">{`Opened ${opens} time(s)`}</Text>
    </Stack>
  );
}

function TableDemo() {
  const [selected, setSelected] = useState<number | null>(null);
  const longError =
    "Failed to initialize the runtime: an unexpected dependency resolution failure in @app/core/runtime. Retry after updating the configuration.";
  const services = [
    { name: "Client", status: "Healthy", latency: "12ms" },
    {
      name: "Server",
      status: "Error",
      latency: "31ms",
    },
    { name: "DB", status: "Healthy", latency: "42ms" },
    { name: "Worker", status: "Healthy", latency: "32ms" },
  ];

  return (
    <Stack maxWidth={80} gap={2}>
      <Table columns={[30, null, 20]}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead textAlign="right">Latency</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.name}>
              <TableCell>{service.name}</TableCell>
              <TableCell>{service.status}</TableCell>
              <TableCell textAlign="right">{service.latency}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Table columns={[30, null, 20]} border="none" bg="secondary" striped>
        <TableHeader bg="primary">
          <TableRow>
            <TableHead variant="default" fg="primaryForeground">
              Name
            </TableHead>
            <TableHead variant="default" fg="primaryForeground">
              Status
            </TableHead>
            <TableHead variant="default" fg="primaryForeground" textAlign="right">
              Latency
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.name}>
              <TableCell>{service.name}</TableCell>
              <TableCell>{service.status}</TableCell>
              <TableCell textAlign="right">{service.latency}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Table id="table-wrap-demo" columns={[30, null, 20]} border="full" borderColor="focus">
        <TableHeader>
          <TableRow>
            <TableHead fg="primary">Name</TableHead>
            <TableHead fg="primary">Status</TableHead>
            <TableHead fg="primary" textAlign="right">
              Latency
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.name}>
              <TableCell>{service.name}</TableCell>
              <TableCell>{service.name === "Server" ? longError : service.status}</TableCell>
              <TableCell textAlign="right">{service.latency}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ScrollArea
        height={13}
        scrollY={false}
        scrollX
        scrollbarTrackColor="secondary"
        border
        paddingX={1}
      >
        <Table columns={[10, null, 10]} wrap={false} width={180}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead textAlign="right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => (
              <TableRow key={service.name}>
                <TableCell>{service.name}</TableCell>
                <TableCell>{service.name === "Server" ? longError : service.status}</TableCell>
                <TableCell textAlign="right">{service.latency}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <Card gap={0}>
        <CardHeader bg="muted">
          <CardTitle>Packages</CardTitle>
        </CardHeader>
        <CardContent paddingX={0}>
          <ScrollArea
            id="table-scroll-demo"
            height={8}
            focusable
            keyboardFallback
            padding={1}
            scrollbarTrackColor="secondary"
          >
            <Table
              id="table-scroll-content"
              columns={[null, null, 25]}
              wrap={false}
              bg="background"
            >
              <TableHeader>
                <TableRow>
                  <TableHead>Build</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 12 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell>Package {index + 1}</TableCell>
                    <TableCell>
                      {index === 2 ? (
                        <Badge color="error">Failed</Badge>
                      ) : (
                        <Badge color="success">Ready</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" onPress={() => setSelected(index + 1)}>
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
        <CardFooter>
          <Text variant="muted">
            {selected === null
              ? "Tab to a build action and press Enter."
              : `Inspecting package ${selected}`}
          </Text>
        </CardFooter>
      </Card>
    </Stack>
  );
}

function ToastDemo() {
  const [notify] = useState(() => createNotificationStore());
  const records = useSyncExternalStore(notify.subscribe, notify.getSnapshot, notify.getSnapshot);
  const [views, setViews] = useState(0);
  const delays = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = delays.current;
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      notify.clearAll();
    };
  }, [notify]);

  function delayedAuto(): void {
    const timer = setTimeout(() => {
      delays.current.delete(timer);
      notify("Build finished", { variant: "success", description: "No errors", delivery: "auto" });
    }, 3_000);
    delays.current.add(timer);
  }

  return (
    <>
      <Text fg="primary">TOASTS</Text>
      <Text variant="muted">
        Hover pauses expiry. Toast actions and close controls are mouse-only.
      </Text>
      <Wrap gap={1}>
        {(["default", "success", "warning", "error", "info"] as const).map((variant) => (
          <Button
            key={variant}
            onPress={() => notify(`${variant} notification`, { variant, delivery: "toast" })}
          >
            {variant}
          </Button>
        ))}
        <Button
          onPress={() =>
            notify("Persistent", {
              duration: 0,
              delivery: "toast",
              description: "Close with the mouse.",
            })
          }
        >
          Persistent
        </Button>
        <Button
          onPress={() =>
            notify("Note created", {
              delivery: "toast",
              action: { label: "View", onPress: () => setViews((value) => value + 1) },
            })
          }
        >
          With action
        </Button>
        <Button
          onPress={() => {
            for (let index = 1; index <= 5; index += 1) {
              notify(`Burst ${index}`, { delivery: "toast" });
            }
          }}
        >
          Burst of five
        </Button>
        <Button onPress={() => notify("Native notification", { delivery: "native" })}>
          Native
        </Button>
        <Button onPress={delayedAuto}>Auto in 3 seconds</Button>
        <Button onPress={() => notify.clearAll()}>Clear history</Button>
      </Wrap>
      <Text variant="muted">{`History: ${records.length} · Viewed: ${views}`}</Text>
      <Toaster store={notify} />
    </>
  );
}
