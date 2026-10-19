import {
  type ColorInput,
  type KeyEvent,
  measureText,
  MouseButton,
  type MouseEvent,
  type SelectOption as NativeSelectOption,
  type OptimizedBuffer,
  parseColor,
  RenderableEvents,
  type RenderContext,
  type RGBA,
  type SelectKeyBinding,
  SelectRenderable,
  type SelectRenderableOptions,
} from "@opentui/core";
import { extend, type SelectProps as OpenTUISelectProps } from "@opentui/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { nativeActionHints, useControlHints } from "@/ui/control-hints";
import { resolveColor, type ThemeColor } from "@/ui/theme";
import { useTheme } from "@/ui/theme-provider";
import { assignRef, consumeNativeKey, setDisabled } from "@/ui/utils";

export interface SelectOption extends NativeSelectOption {
  /** Visible, but skipped by navigation and unavailable for activation. */
  disabled?: boolean;
}

interface ItemSelectOptions extends SelectRenderableOptions {
  options?: SelectOption[];
  disabledColor: ColorInput;
  focused?: boolean;
  onChange?: (index: number, option: SelectOption | null) => void;
  onSelect?: (index: number, option: SelectOption | null) => void;
}

/** Keep native layout and key resolution; add option eligibility, tint and click selection. */
class ItemSelectRenderable extends SelectRenderable {
  private optionFont: SelectRenderableOptions["font"];
  private optionSpacing: number;
  private mutedColor: RGBA;

  constructor(ctx: RenderContext, options: ItemSelectOptions) {
    super(ctx, options);
    this.optionFont = options.font;
    this.optionSpacing = options.itemSpacing ?? 0;
    this.mutedColor = parseColor(options.disabledColor);
    this.selectedIndex = this.getSelectedIndex();
  }

  override get options(): SelectOption[] {
    return super.options;
  }

  override set options(options: SelectOption[]) {
    super.options = options;
    const index = this.eligibleIndex(this.getSelectedIndex());
    if (index >= 0 && index !== this.getSelectedIndex()) {
      super.setSelectedIndex(index);
    }
  }

  override getSelectedOption(): SelectOption | null {
    const option = super.getSelectedOption() as SelectOption | null;
    return option?.disabled ? null : option;
  }

  private findEnabled(start: number, direction: 1 | -1, wrap = false): number {
    const count = this.options.length;
    for (let step = 0; step < count; step++) {
      const index = start + step * direction;
      if (!wrap && (index < 0 || index >= count)) {
        break;
      }
      const candidate = ((index % count) + count) % count;
      if (!this.options[candidate]!.disabled) {
        return candidate;
      }
    }
    return -1;
  }

  private eligibleIndex(index: number): number {
    const next = this.findEnabled(index, 1);
    return next >= 0 ? next : this.findEnabled(index, -1);
  }

  override set selectedIndex(value: number) {
    const clamped = Math.min(Math.max(0, value ?? 0), this.options.length - 1);
    const index = this.eligibleIndex(clamped);
    if (index >= 0) {
      super.selectedIndex = index;
    }
  }

  override setSelectedIndex(index: number): void {
    if (index < 0 || index >= this.options.length) {
      return;
    }
    const eligible = this.eligibleIndex(index);
    if (eligible >= 0) {
      super.setSelectedIndex(eligible);
    }
  }

  private move(direction: 1 | -1, steps: number): void {
    if (!this.options.some((option) => option.disabled)) {
      if (direction === 1) {
        super.moveDown(steps);
      } else {
        super.moveUp(steps);
      }
      return;
    }
    const last = this.options.length - 1;
    let target = this.getSelectedIndex() + direction * steps;
    if (target < 0 || target > last) {
      target = this.wrapSelection
        ? direction === 1
          ? 0
          : last
        : Math.max(0, Math.min(target, last));
    }
    let index = this.findEnabled(target, direction, this.wrapSelection);
    if (index < 0 && !this.wrapSelection) {
      index = this.findEnabled(target, direction === 1 ? -1 : 1);
    }
    const current = this.getSelectedIndex();
    if (
      index >= 0 &&
      index !== current &&
      (this.wrapSelection || (index - current) * direction > 0)
    ) {
      super.setSelectedIndex(index);
    }
  }

  override moveUp(steps = 1): void {
    this.move(-1, steps);
  }

  override moveDown(steps = 1): void {
    this.move(1, steps);
  }

  override set font(font: NonNullable<SelectRenderableOptions["font"]>) {
    this.optionFont = font;
    super.font = font;
  }

  override set itemSpacing(spacing: number) {
    this.optionSpacing = spacing;
    super.itemSpacing = spacing;
  }

  set disabledColor(color: ColorInput) {
    this.mutedColor = parseColor(color);
    this.requestRender();
  }

  private getItemLayout() {
    // Share native row geometry between hit-testing and tinting (including ASCII fonts).
    const fontHeight = this.optionFont
      ? measureText({ text: "A", font: this.optionFont }).height
      : 1;
    const rowHeight = fontHeight + (this.showDescription ? 1 : 0) + this.optionSpacing;
    const visible = Math.max(1, Math.floor(this.height / rowHeight));
    const offset = Math.max(
      0,
      Math.min(this.getSelectedIndex() - Math.floor(visible / 2), this.options.length - visible),
    );
    const markerRow =
      this.showScrollIndicator && this.options.length > visible
        ? 1 + Math.floor((offset / (this.options.length - visible)) * Math.max(1, this.height - 2))
        : -1;
    return { rowHeight, visible, offset, markerRow };
  }

  protected override onMouseEvent(event: MouseEvent): void {
    if (
      event.type !== "down" ||
      event.button !== MouseButton.LEFT ||
      event.defaultPrevented ||
      !this.focusable ||
      this.isDestroyed
    ) {
      return;
    }
    const x = event.x - this.screenX;
    const y = event.y - this.screenY;
    const { rowHeight, visible, offset, markerRow } = this.getItemLayout();
    const row = Math.floor(y / rowHeight);
    if (
      x < 0 ||
      x >= this.width ||
      y < 0 ||
      row >= visible ||
      (row + 1) * rowHeight > this.height ||
      y % rowHeight >= rowHeight - this.optionSpacing ||
      (x === this.width - 1 && y === markerRow)
    ) {
      return;
    }
    const index = offset + row;
    const option = this.options[index];
    if (!option || option.disabled) {
      return;
    }
    this.setSelectedIndex(index);
    if (!this.isDestroyed && this.getSelectedIndex() === index) {
      this.selectCurrent();
    }
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    const dirty = this.isDirty;
    super.renderSelf(buffer, deltaTime);
    if (!dirty || !this.frameBuffer || !this.options.some((option) => option.disabled)) {
      return;
    }
    const { rowHeight, visible, offset, markerRow } = this.getItemLayout();
    const markerCell = markerRow * this.width + this.width - 1;
    this.frameBuffer.withBuffers(({ fg }) => {
      for (let row = 0; row < visible; row++) {
        if (this.options[offset + row]?.disabled && (row + 1) * rowHeight <= this.height) {
          const start = row * rowHeight * this.width;
          const end = ((row + 1) * rowHeight - this.optionSpacing) * this.width;
          for (let cell = start; cell < end; cell++) {
            if (cell !== markerCell) {
              fg.set(this.mutedColor.buffer, cell * 4);
            }
          }
        }
      }
    });
  }
}

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "item-select": typeof ItemSelectRenderable;
  }
}

extend({ "item-select": ItemSelectRenderable });

const defaultKeyBindings: SelectKeyBinding[] = [
  // Native defaults are internal; keep their merge order for alias collisions.
  { name: "up", action: "move-up" },
  { name: "k", action: "move-up" },
  { name: "down", action: "move-down" },
  { name: "j", action: "move-down" },
  { name: "up", shift: true, action: "move-up-fast" },
  { name: "down", shift: true, action: "move-down-fast" },
  { name: "return", action: "select-current" },
  { name: "linefeed", action: "select-current" },
  { name: "l", action: "move-down" },
  { name: "h", action: "move-up" },
  { name: "n", ctrl: true, action: "move-down" },
  { name: "p", ctrl: true, action: "move-up" },
  { name: "d", ctrl: true, action: "move-down-fast" },
  { name: "u", ctrl: true, action: "move-up-fast" },
];

type ThemedColorProps = {
  backgroundColor?: ThemeColor;
  textColor?: ThemeColor;
  descriptionColor?: ThemeColor;
  focusedBackgroundColor?: ThemeColor;
  focusedTextColor?: ThemeColor;
  selectedBackgroundColor?: ThemeColor;
  selectedTextColor?: ThemeColor;
  selectedDescriptionColor?: ThemeColor;
  focusedSelectedBackgroundColor?: ThemeColor;
  focusedSelectedTextColor?: ThemeColor;
  focusedSelectedDescriptionColor?: ThemeColor;
};

export interface SelectProps
  extends
    Omit<OpenTUISelectProps, keyof ThemedColorProps | "options" | "onChange" | "onSelect">,
    ThemedColorProps {
  disabled?: boolean;
  options?: SelectOption[];
  onChange?: (index: number, option: SelectOption | null) => void;
  onSelect?: (index: number, option: SelectOption | null) => void;
}

export function Select({
  ref,
  disabled = false,
  focused,

  backgroundColor = "muted",
  textColor = "foreground",
  descriptionColor = "mutedForeground",

  focusedBackgroundColor = "muted",
  focusedTextColor = "foreground",

  selectedBackgroundColor = "primary",
  selectedTextColor = "primaryForeground",
  selectedDescriptionColor = "mutedForeground",

  focusedSelectedBackgroundColor = "focus",
  focusedSelectedTextColor = "primary",
  focusedSelectedDescriptionColor = "primaryForeground",

  keyBindings = [],
  keyAliasMap,
  options = [],
  showSelectionIndicator,
  onSelect,
  onKeyDown,

  ...props
}: SelectProps) {
  const theme = useTheme();
  const selectRef = useRef<SelectRenderable | null>(null);
  const effectiveBindings = [...defaultKeyBindings, ...keyBindings];
  const hasEnabledOptions = options.some((option) => !option.disabled);
  useControlHints(
    selectRef,
    !disabled && hasEnabledOptions && onSelect
      ? nativeActionHints(
          effectiveBindings,
          "select-current",
          "Select",
          keyAliasMap,
          (binding) =>
            binding.name.toLowerCase() === "g" && !binding.ctrl && !binding.meta && !binding.super,
        )
      : [],
  );
  const [isFocused, setIsFocused] = useState(false);

  const setSelectRef = useCallback(
    (node: SelectRenderable | null) => {
      selectRef.current = node;
      assignRef(ref, node);

      if (!node) return;

      setIsFocused(node.focused);

      const handleFocus = () => setIsFocused(true);
      const handleBlur = () => setIsFocused(false);

      node.on(RenderableEvents.FOCUSED, handleFocus);
      node.on(RenderableEvents.BLURRED, handleBlur);

      return () => {
        node.off(RenderableEvents.FOCUSED, handleFocus);
        node.off(RenderableEvents.BLURRED, handleBlur);

        if (selectRef.current === node) {
          selectRef.current = null;
        }

        assignRef(ref, null);
      };
    },
    [ref],
  );

  useLayoutEffect(() => {
    setDisabled(selectRef.current, disabled);
  }, [disabled]);

  const effectiveFocused = isFocused && !disabled;

  const currentSelectedBackgroundColor = disabled
    ? "secondary"
    : effectiveFocused
      ? focusedSelectedBackgroundColor
      : selectedBackgroundColor;

  const currentSelectedTextColor = disabled
    ? "mutedForeground"
    : effectiveFocused
      ? focusedSelectedTextColor
      : selectedTextColor;

  const currentSelectedDescriptionColor = disabled
    ? "mutedForeground"
    : effectiveFocused
      ? focusedSelectedDescriptionColor
      : selectedDescriptionColor;

  function handleKeyDown(event: KeyEvent) {
    onKeyDown?.(event);

    if (event.defaultPrevented || disabled) {
      return;
    }

    const isG = event.name.toLowerCase() === "g";

    const select = selectRef.current;

    if (isG && !event.ctrl && !event.meta && !event.super && select && select.options.length > 0) {
      event.preventDefault();
      const isLast = event.shift || event.name === "G";
      select.setSelectedIndex(isLast ? select.options.length - 1 : 0);
      return;
    }
    consumeNativeKey(select, event);
  }

  return (
    <item-select
      {...props}
      options={options}
      disabledColor={resolveColor(theme, "mutedForeground")}
      showSelectionIndicator={hasEnabledOptions ? showSelectionIndicator : false}
      onSelect={onSelect}
      keyAliasMap={keyAliasMap}
      ref={setSelectRef}
      focused={disabled ? false : focused}
      backgroundColor={resolveColor(theme, disabled ? "muted" : backgroundColor)}
      textColor={resolveColor(theme, disabled ? "mutedForeground" : textColor)}
      focusedBackgroundColor={resolveColor(theme, disabled ? "muted" : focusedBackgroundColor)}
      focusedTextColor={resolveColor(theme, disabled ? "mutedForeground" : focusedTextColor)}
      selectedBackgroundColor={resolveColor(
        theme,
        hasEnabledOptions
          ? currentSelectedBackgroundColor
          : disabled
            ? "muted"
            : effectiveFocused
              ? focusedBackgroundColor
              : backgroundColor,
      )}
      selectedTextColor={resolveColor(theme, currentSelectedTextColor)}
      descriptionColor={resolveColor(theme, disabled ? "mutedForeground" : descriptionColor)}
      selectedDescriptionColor={resolveColor(theme, currentSelectedDescriptionColor)}
      keyBindings={effectiveBindings}
      onKeyDown={handleKeyDown}
    />
  );
}
