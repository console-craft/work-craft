import { useState } from "react";

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
import { FocusManager } from "@/ui/focus-manager";
import { HStack } from "@/ui/primitives/hstack";
import { Spacer } from "@/ui/primitives/spacer";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider.tsx";
import { defaultTheme } from "@/ui/themes/default.ts";

export function UIDemo() {
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
    <ThemeProvider theme={defaultTheme}>
      <FocusManager focusScopeId="ui-demo" />
      <Stack id="ui-demo" focusable maxWidth={200} paddingX={6} paddingY={1}>
        <Text fg="primary">BUTTONS</Text>
        <HStack>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button variant="destructive">Destructive</Button>
        </HStack>

        <Text fg="primary">INPUTS</Text>
        <HStack gap={1}>
          <Input placeholder="Name" width="33%" />
          <Spacer />
          <Input value="Doe" width="33%" disabled />
          <Spacer />
          <NumberInput
            width="33%"
            value={price}
            min={0}
            step={0.1}
            max={5}
            onValueChange={setPrice}
            placeholder="Price"
          />
        </HStack>

        <Text fg="primary">TEXTAREA</Text>
        <HStack gap={1}>
          <Textarea placeholder="Bio" height={3} width="50%"></Textarea>
          <Spacer />
          <Textarea initialValue="Hello" height={3} width="50%" disabled></Textarea>
        </HStack>

        <Text fg="primary">SELECT</Text>
        <HStack>
          <Select
            height={6}
            width="33%"
            options={[
              { name: "Monday", description: "First day", value: "mon" },
              { name: "Wednesday", description: "Third day", value: "wed" },
              { name: "Friday", description: "Fifth day", value: "fri" },
            ]}
          />

          <Select
            height={6}
            width="33%"
            disabled
            options={[
              { name: "Monday", description: "First day", value: "mon" },
              { name: "Wednesday", description: "Third day", value: "wed" },
              { name: "Friday", description: "Fifth day", value: "fri" },
            ]}
          />

          <Select
            height={6}
            width="33%"
            options={[
              { name: "Monday", description: "", value: "mon" },
              { name: "Wednesday", description: "", value: "wed" },
              { name: "Friday", description: "", value: "fri" },
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
          <Toggle
            pressed={bold}
            onPressedChange={setBold}

            alignSelf="flex-start"
            flexShrink={0}
          >
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
          <Spacer />
          <Stack width="90%">
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
      </Stack>
    </ThemeProvider>
  );
}
