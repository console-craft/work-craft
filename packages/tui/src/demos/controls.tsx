import { useState } from "react";

import { DemoPage } from "@/demos/demo-page";
import { useDemoTheme } from "@/demos/use-demo-theme";
import { Button } from "@/ui/controls/button.tsx";
import { Checkbox } from "@/ui/controls/checkbox";
import { Input } from "@/ui/controls/input";
import { NumberInput } from "@/ui/controls/number";
import { Radio, RadioGroup } from "@/ui/controls/radio";
import { Select } from "@/ui/controls/select.tsx";
import { Slider } from "@/ui/controls/slider";
import { Switch } from "@/ui/controls/switch";
import { Textarea } from "@/ui/controls/textarea";
import { Toggle, ToggleGroup } from "@/ui/controls/toggle";
import { HStack } from "@/ui/primitives/hstack";
import { Spacer } from "@/ui/primitives/spacer";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider.tsx";

export function ControlsDemo() {
  const theme = useDemoTheme();
  const [fruit, setFruit] = useState("banana");
  const [bold, setBold] = useState(true);
  const [alignment, setAlignment] = useState<string>();
  const [styles, setStyles] = useState<string[]>(["bold", "italic"]);
  const [telemetry, setTelemetry] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [tos, setTos] = useState(true);
  const [eula, setEula] = useState(false);
  const [price, setPrice] = useState<number | undefined>();
  const [volume, setVolume] = useState(50);

  return (
    <ThemeProvider theme={theme}>
      <DemoPage id="controls-demo">
        <Text variant="muted">{`Theme: ${theme.name} · Ctrl+t to switch`}</Text>
        <Text fg="primary">BUTTONS</Text>
        <HStack>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button variant="destructive">Destructive</Button>
        </HStack>

        <Text fg="primary">INPUTS</Text>
        <HStack gap={3}>
          <Input placeholder="Name" flexBasis={0} flexGrow={1} />
          <Input value="Doe" disabled flexBasis={0} flexGrow={1} />
          <NumberInput
            value={price}
            min={0}
            step={0.1}
            max={5}
            onValueChange={setPrice}
            placeholder="Price"
            flexBasis={0}
            flexGrow={1}
          />
        </HStack>

        <Text fg="primary">TEXTAREA</Text>
        <HStack gap={3}>
          <Textarea placeholder="Bio" height={3} flexBasis={0} flexGrow={1}></Textarea>
          <Textarea initialValue="Hello" height={3} flexBasis={0} flexGrow={1} disabled></Textarea>
        </HStack>

        <Text fg="primary">SELECT</Text>
        <HStack gap={2}>
          <Select
            height={6}
            flexGrow={1}
            options={[
              { name: "Monday", description: "First day", value: "mon" },
              { name: "Wednesday", description: "Third day", value: "wed" },
              { name: "Friday", description: "Fifth day", value: "fri" },
            ]}
          />

          <Select
            height={6}
            flexGrow={1}
            disabled
            options={[
              { name: "Monday", description: "First day", value: "mon" },
              { name: "Wednesday", description: "Third day", value: "wed" },
              { name: "Friday", description: "Fifth day", value: "fri" },
            ]}
          />

          <Select
            height={6}
            flexGrow={1}
            showDescription={false}
            options={[
              { name: "Monday", description: "First day", value: "mon" },
              { name: "Tuesday", description: "Second day", value: "tue" },
              { name: "Wednesday", description: "Third day", value: "wed" },
              { name: "Thursday", description: "Forth day", value: "thu" },
              { name: "Friday", description: "Fifth day", value: "fri" },
              { name: "Saturday", description: "Sixth day", value: "sat" },
              { name: "Sunday", description: "Seventh day", value: "sun" },
            ]}
          />
        </HStack>

        <Text fg="primary">SWITCHES</Text>
        <Stack width={55}>
          <Switch checked={telemetry} onCheckedChange={setTelemetry}>
            Telemetry
          </Switch>
          <Switch checked={notifications} onCheckedChange={setNotifications}>
            Notifications
          </Switch>
          <Switch disabled>High Contrast</Switch>
        </Stack>

        <Text fg="primary">CHECKBOXES</Text>
        <Stack width={55}>
          <Checkbox
            indeterminate={(tos && !eula) || (!tos && eula)}
            checked={tos || eula}
            onCheckedChange={() => {
              if (tos || eula) {
                setTos(false);
                setEula(false);
              } else {
                setTos(true);
                setEula(true);
              }
            }}
          >
            Consent to terms
          </Checkbox>
          <Checkbox checked={tos} onCheckedChange={setTos}>
            Read TOS
          </Checkbox>
          <Checkbox checked={eula} onCheckedChange={setEula}>
            Read EULA
          </Checkbox>
          <Checkbox disabled>Accept NDA</Checkbox>
        </Stack>

        <Text fg="primary">RADIOS</Text>

        <RadioGroup value={fruit} onValueChange={setFruit} width={55}>
          <Radio value="apple">Apple</Radio>
          <Radio value="banana">Banana</Radio>
          <Radio value="orange" disabled>
            Orange
          </Radio>
        </RadioGroup>
        <RadioGroup orientation="horizontal" value={fruit} onValueChange={setFruit}>
          <Radio value="apple">Apple</Radio>
          <Radio value="banana">Banana</Radio>
          <Radio value="orange" disabled>
            Orange
          </Radio>
        </RadioGroup>

        <Text fg="primary">TOGGLES</Text>
        <HStack>
          <Toggle pressed={bold} onPressedChange={setBold} alignSelf="flex-start" flexShrink={0}>
            Bold
          </Toggle>
          <ToggleGroup type="single" value={alignment} onValueChange={setAlignment}>
            <Toggle value="left">Left</Toggle>
            <Toggle value="center">Center</Toggle>
            <Toggle value="right" disabled>
              Right
            </Toggle>
          </ToggleGroup>
          <ToggleGroup type="multiple" value={styles} onValueChange={setStyles}>
            <Toggle value="bold">B</Toggle>
            <Toggle value="italic">I</Toggle>
            <Toggle value="underline">U</Toggle>
          </ToggleGroup>
        </HStack>

        <Text fg="primary">SLIDERS</Text>

        <HStack>
          <HStack width={5}>
            <Slider
              orientation="vertical"
              value={volume}
              onValueChange={setVolume}
              min={0}
              max={100}
              step={5}
              height={5}
            />
            <Slider
              orientation="vertical"
              value={volume}
              onValueChange={setVolume}
              min={0}
              max={100}
              step={5}
              height={5}
              disabled
            />
          </HStack>
          <Stack flexGrow={1} alignItems="center">
            <Slider
              value={volume}
              onValueChange={setVolume}
              min={0}
              max={100}
              step={5}
              width="50%"
            />
            <Slider
              value={volume}
              onValueChange={setVolume}
              min={0}
              max={100}
              step={5}
              width="50%"
              disabled
            />
          </Stack>
        </HStack>
      </DemoPage>
    </ThemeProvider>
  );
}
