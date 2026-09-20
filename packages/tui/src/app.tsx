import { WorkCraftShell } from "./shell.tsx";
import { useWorkCraft } from "./use-work-craft.ts";

export function App() {
  return <WorkCraftShell workCraft={useWorkCraft()} />;
}
