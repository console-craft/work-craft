import { type InputRenderable, type KeyEvent } from "@opentui/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { Input, type InputProps } from "@/ui/controls/input";
import { assignRef } from "@/ui/utils";

const numberPattern = /^-?\d*\.?\d*$/;

function parseDraft(value: string): number | undefined {
  if (value === "" || value === "-" || value === "." || value === "-.") {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function addStep(value: number, step: number, direction: -1 | 1) {
  // Clean up common floating point artifacts such as
  // 0.2 + 0.1 = 0.30000000000000004.
  return Number((value + direction * step).toPrecision(15));
}

export interface NumberInputProps extends Omit<
  InputProps,
  "value" | "onInput" | "onChange" | "onSubmit"
> {
  value?: number;
  min?: number;
  max?: number;
  step?: number;

  onValueChange?: (value: number | undefined) => void;
  onSubmit?: (value: number | undefined) => void;
}

export function NumberInput({
  ref,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onValueChange,
  onSubmit,
  onKeyDown,
  ...props
}: NumberInputProps) {
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error("<NumberInput> step must be a positive finite number");
  }

  if (min !== undefined && max !== undefined && min > max) {
    throw new Error("<NumberInput> min cannot be greater than max");
  }

  const inputRef = useRef<InputRenderable | null>(null);

  const initialDraft = formatValue(value, step);

  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const semanticValueRef = useRef<number | undefined>(value);

  const setInputRef = useCallback(
    (node: InputRenderable | null) => {
      inputRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  function updateDraft(nextDraft: string) {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  function emitValueChange(nextValue: number | undefined) {
    if (Object.is(semanticValueRef.current, nextValue)) {
      return;
    }

    semanticValueRef.current = nextValue;
    onValueChange?.(nextValue);
  }

  function clampValue(nextValue: number) {
    let result = nextValue;

    if (min !== undefined) {
      result = Math.max(min, result);
    }

    if (max !== undefined) {
      result = Math.min(max, result);
    }

    return result;
  }

  function commit(rawValue: string) {
    const parsed = parseDraft(rawValue);

    if (parsed === undefined) {
      updateDraft("");
      emitValueChange(undefined);

      return undefined;
    }

    const committed = clampValue(parsed);

    updateDraft(formatValue(committed, step));
    emitValueChange(committed);

    return committed;
  }

  function getDecimalPlaces(value: number) {
    const text = value.toString();

    if (text.includes("e-")) {
      return Number(text.split("e-")[1]);
    }

    return text.includes(".") ? text.split(".")[1].length : 0;
  }

  function formatValue(value: number | undefined, step: number) {
    if (value === undefined) {
      return "";
    }

    const decimalPlaces = getDecimalPlaces(step);

    return decimalPlaces > 0 ? value.toFixed(decimalPlaces) : String(value);
  }

  function handleInput(rawValue: string) {
    // Reject characters that cannot be part of our decimal
    // number grammar.
    if (!numberPattern.test(rawValue)) {
      const input = inputRef.current;

      if (input) {
        input.value = draftRef.current;
      }

      return;
    }

    updateDraft(rawValue);
    emitValueChange(parseDraft(rawValue));
  }

  function stepValue(direction: -1 | 1) {
    const current = parseDraft(draftRef.current) ?? 0;

    const next = clampValue(addStep(current, step, direction));

    updateDraft(formatValue(next, step));
    emitValueChange(next);
  }

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    const noModifiers = !event.ctrl && !event.meta && !event.super && !event.shift;

    if (!noModifiers) {
      return;
    }

    if (event.name === "up" || event.name === "k") {
      event.preventDefault();
      stepValue(1);
      return;
    }

    if (event.name === "down" || event.name === "j") {
      event.preventDefault();
      stepValue(-1);
    }
  }

  function handleChange(rawValue: string) {
    commit(rawValue);
  }

  function handleSubmit(rawValue: string) {
    const committed = commit(rawValue);
    onSubmit?.(committed);
  }

  useLayoutEffect(() => {
    semanticValueRef.current = value;

    // Preserve useful editing representations such as:
    //
    //   "1."
    //   "01"
    //   ".5"
    //
    // when their semantic value already matches the prop.
    if (Object.is(parseDraft(draftRef.current), value)) {
      return;
    }

    updateDraft(formatValue(value, step));
  }, [value]);

  return (
    <Input
      {...props}
      ref={setInputRef}
      value={draft}
      disabled={disabled}
      onInput={handleInput}
      onChange={handleChange}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
    />
  );
}
