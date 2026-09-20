import { Panel } from "@/components/ui/panel";

export type CreateKind = "session" | "workspace" | "project" | "item";

export type CreatePromptProps = {
  kind: CreateKind;
  value: string;
  error: string | null;
  onChange(value: string): void;
  onSubmit(value: string): void;
};

export function CreatePrompt({ error, kind, value, onChange, onSubmit }: CreatePromptProps) {
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
      {error === null ? null : <text fg="#EF4444">{error}</text>}
    </Panel>
  );
}
