import type { InputRenderable } from "@opentui/core";
import { type ReactNode, useRef, useState } from "react";

import type { CreateKind } from "@/shell/model.ts";
import { DialogClose, DialogFooter, DialogHeader, DialogTitle } from "@/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@/ui/components/field";
import { Button } from "@/ui/controls/button";
import { Input } from "@/ui/controls/input";
import { Stack } from "@/ui/primitives/stack";

export type CreatePromptProps = {
  kind: CreateKind;
  value: string;
  error: string | null;
  onChange(value: string): void;
  onSubmit(value: string): void;
};

export function CreatePrompt({
  error,
  kind,
  value,
  onChange,
  onSubmit,
}: CreatePromptProps): ReactNode {
  const inputRef = useRef<InputRenderable | null>(null);
  const [missingName, setMissingName] = useState(false);
  const label = kind === "directory" ? "Path" : kind.startsWith("generic-") ? "Title" : "Name";
  const fieldError = missingName ? `${label} is required.` : error;

  function submit(value: string): void {
    const name = kind === "directory" ? value : value.trim();
    if (name.trim() === "") {
      setMissingName(true);
      return;
    }
    setMissingName(false);
    onSubmit(name);
  }

  return (
    <Stack>
      <DialogHeader>
        <DialogTitle>
          {kind === "directory"
            ? "Register directory"
            : `New ${kind.startsWith("generic-") ? "item" : kind}`}
        </DialogTitle>
      </DialogHeader>
      <Field required invalid={fieldError !== null}>
        <FieldLabel>{label}</FieldLabel>
        <Input
          id={`create:${label.toLowerCase()}`}
          ref={inputRef}
          keyBindings={[{ name: "h", ctrl: true, action: "backspace" }]}
          placeholder={
            kind === "directory" ? "Existing directory path" : `${kind} ${label.toLowerCase()}`
          }
          value={value}
          onInput={(value) => {
            setMissingName(false);
            onChange(value);
          }}
          onSubmit={submit}
        />
        <FieldError marginTop={1}>{fieldError}</FieldError>
      </Field>
      <DialogFooter>
        <Button id="create:submit" onPress={() => submit(inputRef.current?.value ?? "")}>
          {kind === "directory" ? "Register" : "Create"}
        </Button>
        <DialogClose id="dialog:cancel" variant="ghost">
          Cancel
        </DialogClose>
      </DialogFooter>
    </Stack>
  );
}
