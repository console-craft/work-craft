import type { CreateKind } from "@/shell/model.ts";
import { Input } from "@/ui/controls/input.tsx";
import { Box } from "@/ui/primitives/box.tsx";
import { Divider } from "@/ui/primitives/divider.tsx";
import { Text } from "@/ui/primitives/text.tsx";
import { useTheme } from "@/ui/theme-provider.tsx";

// import { Stack } from "@/ui/primitives/stack.tsx";
// import { Button } from "@/ui/controls/button.tsx";
// import { HStack } from "@/ui/primitives/hstack.tsx";
// import { Textarea } from "@/ui/controls/textarea.tsx";
// import { Select } from "@/ui/controls/select.tsx";

export type CreatePromptProps = {
  kind: CreateKind;
  value: string;
  error: string | null;
  onChange(value: string): void;
  onSubmit(value: string): void;
};

export function CreatePrompt({ error, kind, value, onChange, onSubmit }: CreatePromptProps) {
  const theme = useTheme();
  return (
    <Box border width="100%">
      <Box paddingLeft={1} paddingRight={1}>
        <Text fg={theme.colors.primary}>
          <b>{`New ${kind}`}</b>
        </Text>
      </Box>
      <Divider />
      <Box paddingLeft={1} paddingRight={1}>
        <Input
          focused
          placeholder={`${kind} name`}
          value={value}
          onInput={onChange}
          onSubmit={(value) => {
            if (typeof value !== "string") {
              return;
            }
            const name = value.trim();
            if (name !== "") {
              onSubmit(name);
            }
          }}
        />
        {error === null ? null : <Text fg={theme.colors.error}>{error}</Text>}
      </Box>
      {/* <Stack marginTop={1}> */}
      {/*   <Input placeholder="foo" /> */}
      {/*   <Textarea placeholder="bar" height={4} */}
      {/*     onSubmit={() => console.log('SUBMITTED')} */}
      {/*   /> */}
      {/*   <Select */}
      {/*     width={30} */}
      {/*     height={6} */}
      {/*     options={[ */}
      {/*       { */}
      {/*         name: "Apple", */}
      {/*         description: "Crisp and sweet", */}
      {/*         value: "apple", */}
      {/*       }, */}
      {/*       { */}
      {/*         name: "Banana", */}
      {/*         description: "Soft and yellow", */}
      {/*         value: "banana", */}
      {/*       }, */}
      {/*       { */}
      {/*         name: "Orange", */}
      {/*         description: "Citrusy and juicy", */}
      {/*         value: "orange", */}
      {/*       }, */}
      {/*     ]} */}
      {/*     onSelect={(index, option) => { */}
      {/*       console.log("Selected fruit:", { */}
      {/*         index, */}
      {/*         value: option?.value, */}
      {/*         name: option?.name, */}
      {/*       }); */}
      {/*     }} */}
      {/*   /> */}
      {/* </Stack> */}
      {/* <HStack marginTop={1}> */}
      {/*   <Button variant="primary">Test button</Button> */}
      {/*   <Button variant="ghost">Test button</Button> */}
      {/*   <Button variant="secondary">Test button</Button> */}
      {/*   <Button variant="secondary">Test button</Button> */}
      {/*   <Button disabled>Test button</Button> */}
      {/*   <Button variant="destructive">Test button</Button> */}
      {/* </HStack> */}
    </Box>
  );
}
