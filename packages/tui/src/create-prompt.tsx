import { Panel } from "@/components/ui/panel";

export type CreateKind = "session" | "workspace" | "project" | "item";

export type CreatePromptProps = {
  kind: CreateKind;
  onSubmit(value: string): void;
};

export function CreatePrompt({ kind, onSubmit }: CreatePromptProps) {
  return (
    <Panel title={`New ${kind}`}>
      <input
        focused
        placeholder={`${kind} name`}
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
    </Panel>
  );
}
