import { Panel } from "@/components/ui/panel";
import { useTheme } from "@/hooks/use-theme";
import type { CreateKind } from "./model.ts";

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
    <Panel title={`New ${kind}`}>
      <input
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
      {error === null ? null : <text fg={theme.colors.error}>{error}</text>}
    </Panel>
  );
}
