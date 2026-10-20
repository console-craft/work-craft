import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Toaster } from "@/ui/components/toast";
import { Button } from "@/ui/controls/button";
import { createNotificationStore } from "@/ui/notifications";
import { Text } from "@/ui/primitives/text";
import { Wrap } from "@/ui/primitives/wrap";

export function ToastDemo(): ReactNode {
  const [notify] = useState(() => createNotificationStore());
  const records = useSyncExternalStore(notify.subscribe, notify.getSnapshot, notify.getSnapshot);
  const [views, setViews] = useState(0);
  const delays = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = delays.current;
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      notify.clearAll();
    };
  }, [notify]);

  function delayedAuto(): void {
    const timer = setTimeout(() => {
      delays.current.delete(timer);
      notify("Build finished", { variant: "success", description: "No errors", delivery: "auto" });
    }, 3_000);
    delays.current.add(timer);
  }

  return (
    <>
      <Text fg="primary">TOASTS</Text>
      <Text variant="muted">
        Hover pauses expiry. Toast actions and close controls are mouse-only.
      </Text>
      <Wrap gap={1}>
        {(["default", "success", "warning", "error", "info"] as const).map((variant) => (
          <Button
            key={variant}
            onPress={() => notify(`${variant} notification`, { variant, delivery: "toast" })}
          >
            {variant}
          </Button>
        ))}
        <Button
          onPress={() =>
            notify("Persistent", {
              duration: 0,
              delivery: "toast",
              description: "Close with the mouse.",
            })
          }
        >
          Persistent
        </Button>
        <Button
          onPress={() =>
            notify("Note created", {
              delivery: "toast",
              action: { label: "View", onPress: () => setViews((value) => value + 1) },
            })
          }
        >
          With action
        </Button>
        <Button
          onPress={() => {
            for (let index = 1; index <= 5; index += 1) {
              notify(`Burst ${index}`, { delivery: "toast" });
            }
          }}
        >
          Burst of five
        </Button>
        <Button onPress={() => notify("Native notification", { delivery: "native" })}>
          Native
        </Button>
        <Button onPress={delayedAuto}>Auto in 3 seconds</Button>
        <Button onPress={() => notify.clearAll()}>Clear history</Button>
      </Wrap>
      <Text variant="muted">{`History: ${records.length} · Viewed: ${views}`}</Text>
      <Toaster store={notify} />
    </>
  );
}
