import { createContext, useContext, useMemo } from "react";

import { symbols } from "@/ui/icons/symbols";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import type { TextProps } from "@/ui/primitives/text";
import { Text } from "@/ui/primitives/text";
import { isTextContent } from "@/ui/utils";

interface FieldContextValue {
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useField() {
  const context = useContext(FieldContext);

  if (!context) {
    throw new Error("Field components must be used within <Field>");
  }

  return context;
}

export interface FieldProps extends StackProps {
  invalid?: boolean;
  required?: boolean;
}

export function Field({
  invalid = false,
  required = false,
  gap = 0,
  children,
  ...props
}: FieldProps) {
  const context = useMemo(
    () => ({
      invalid,
      required,
    }),
    [invalid, required],
  );

  return (
    <FieldContext.Provider value={context}>
      <Stack gap={gap} {...props}>
        {children}
      </Stack>
    </FieldContext.Provider>
  );
}

export interface FieldLabelProps extends HStackProps {}

export function FieldLabel({
  children,
  gap = 1,
  alignSelf = "flex-start",
  ...props
}: FieldLabelProps) {
  const { invalid, required } = useField();

  const color = invalid ? "error" : "foreground";

  return (
    <HStack gap={gap} alignSelf={alignSelf} {...props}>
      {isTextContent(children) ? <Text fg={color}>{children}</Text> : children}

      {required && <Text fg="error">*</Text>}
    </HStack>
  );
}

export interface FieldDescriptionProps extends TextProps {}

export function FieldDescription(props: FieldDescriptionProps) {
  return <Text variant="muted" {...props} />;
}

export interface FieldErrorProps extends Omit<HStackProps, "visible"> {}

export function FieldError({
  children,
  gap = 1,
  alignSelf = "flex-start",
  ...props
}: FieldErrorProps) {
  const { invalid } = useField();

  return (
    <HStack gap={gap} alignSelf={alignSelf} {...props} visible={invalid}>
      <Text fg="error">{symbols.crossBig}</Text>

      {isTextContent(children) ? <Text fg="error">{children}</Text> : children}
    </HStack>
  );
}
