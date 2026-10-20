import { useEffect, useState } from "react";

import type { TextProps } from "@/ui/primitives/text";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theming/theme";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export interface SpinnerProps extends Omit<TextProps, "children" | "transform" | "fg"> {
  color?: ThemeColor;
}

export function Spinner({ color = "foreground", ...props }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((frame) => (frame + 1) % frames.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return (
    <Text fg={color} {...props}>
      {frames[frame]}
    </Text>
  );
}
