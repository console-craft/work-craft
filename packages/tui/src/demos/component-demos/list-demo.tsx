import { type ReactNode, useState } from "react";

import { List, ListItem } from "@/ui/components/list";
import { Button } from "@/ui/controls/button";
import { Input } from "@/ui/controls/input";
import { useNativeFocus } from "@/ui/interaction/focus-manager";
import { HStack } from "@/ui/primitives/hstack";
import { Icon } from "@/ui/primitives/icon";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export function ListDemo(): ReactNode {
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
