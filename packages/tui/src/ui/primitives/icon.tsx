import { type IconName, icons } from "@/ui/icons/nerd";
import { Text, type TextProps } from "@/ui/primitives/text";

export interface IconProps extends Omit<TextProps, "children" | "content"> {
  name: IconName;
}

export function Icon({ name, ...props }: IconProps) {
  return <Text {...props}>{icons[name]}</Text>;
}
