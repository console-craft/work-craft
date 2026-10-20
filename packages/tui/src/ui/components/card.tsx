import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import type { TextProps } from "@/ui/primitives/text";
import { Text } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theming/theme";

export interface CardProps extends StackProps {}

export function Card(props: CardProps) {
  return <Stack border {...props} />;
}

export interface CardHeaderProps extends StackProps {}

export function CardHeader(props: CardHeaderProps) {
  return <Stack paddingX={1} gap={0} {...props} />;
}

export interface CardTitleProps extends TextProps {}

export function CardTitle(props: CardTitleProps) {
  return <Text variant="heading" {...props} />;
}

export interface CardDescriptionProps extends TextProps {}

export function CardDescription(props: CardDescriptionProps) {
  return <Text variant="muted" {...props} />;
}

export interface CardContentProps extends StackProps {}

export function CardContent(props: CardContentProps) {
  return <Stack paddingX={1} {...props} />;
}

export interface CardFooterProps extends HStackProps {
  dividerColor?: ThemeColor;
}

export function CardFooter({ dividerColor = "border", ...props }: CardFooterProps) {
  return <HStack border={["top"]} borderColor={dividerColor} paddingX={1} {...props} />;
}
