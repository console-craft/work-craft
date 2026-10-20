import { createClient } from "@work-craft/server/client";
import { useEffect, useSyncExternalStore } from "react";

import { createWorkCraftStore, type WorkCraftState } from "@/client/store";

const store = createWorkCraftStore(createClient());

export function useWorkCraft(): WorkCraftState {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  useEffect(() => {
    void store.start();
    return () => store.stop();
  }, []);
  return state;
}
