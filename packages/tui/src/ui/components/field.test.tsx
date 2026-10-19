import { expect, test } from "bun:test";

import { parseColor, type TextRenderable } from "@opentui/core";
import { act, type Dispatch, type SetStateAction, useState } from "react";

import { testRender } from "@/test-render";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/ui/components/field";
import { Text } from "@/ui/primitives/text";
import { ThemeProvider } from "@/ui/theme-provider";
import { defaultTheme } from "@/ui/themes/default";

test.each([
  ["label", FieldLabel],
  ["error", FieldError],
] as const)("field %s renders multiple text children", async (_name, Component) => {
  const setup = await testRender(
    <ThemeProvider theme={defaultTheme}>
      <Field invalid>
        <Component>Message {2}</Component>
      </Field>
    </ThemeProvider>,
    { width: 40, height: 4 },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Message 2");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("Field updates required and invalid presentation without leaving hidden error layout behind", async () => {
  let update!: Dispatch<SetStateAction<{ required: boolean; invalid: boolean }>>;
  function Fixture() {
    const [state, setState] = useState({ required: true, invalid: false });
    update = setState;
    return (
      <ThemeProvider theme={defaultTheme}>
        <Field {...state}>
          <FieldLabel id="label">Name</FieldLabel>
          <FieldDescription>Use a short name</FieldDescription>
          <FieldError id="error">Required</FieldError>
        </Field>
        <Text id="after">After</Text>
      </ThemeProvider>
    );
  }
  const setup = await testRender(<Fixture />, { width: 30, height: 6 });
  try {
    await act(async () => setup.flush());
    const label = setup.renderer.root.findDescendantById("label")!;
    const text = label.getChildren()[0] as TextRenderable;
    const after = setup.renderer.root.findDescendantById("after")!;
    const error = setup.renderer.root.findDescendantById("error")!;
    expect(setup.captureCharFrame()).toContain("Name *");
    expect(setup.captureCharFrame()).not.toContain("Required");
    expect(after.screenY).toBe(2);
    expect(text.fg.toInts()).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
    act(() => update({ required: false, invalid: true }));
    await act(async () => setup.flush());
    expect(setup.captureCharFrame()).not.toContain("*");
    expect(setup.captureCharFrame()).toContain("Required");
    expect(after.screenY).toBe(3);
    expect(text.fg.toInts()).toEqual(parseColor(defaultTheme.colors.error).toInts());
    expect((error.getChildren()[1] as TextRenderable).fg.toInts()).toEqual(
      parseColor(defaultTheme.colors.error).toInts(),
    );
    act(() => update({ required: true, invalid: false }));
    await act(async () => setup.flush());
    expect(setup.renderer.root.findDescendantById("error")).toBe(error);
    expect(after.screenY).toBe(2);
    expect(setup.captureCharFrame()).not.toContain("Required");
    expect(setup.captureCharFrame()).toContain("Name *");
    expect(text.fg.toInts()).toEqual(parseColor(defaultTheme.colors.foreground).toInts());
  } finally {
    act(() => setup.renderer.destroy());
  }
});
