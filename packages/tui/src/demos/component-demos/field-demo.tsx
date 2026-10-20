import { type ReactNode, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/ui/components/field";
import { Input } from "@/ui/controls/input";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export function FieldDemo(): ReactNode {
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

  return (
    <>
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
    </>
  );
}
