import { expect, test } from "bun:test";

import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import { Field, FieldError, FieldLabel } from "@/ui/components/field";
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
