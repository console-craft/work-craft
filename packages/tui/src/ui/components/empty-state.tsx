import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import type { TextProps } from "@/ui/primitives/text";
import { Text } from "@/ui/primitives/text";

export interface EmptyStateProps extends StackProps {}

export function EmptyState({
  gap = 1,
  alignItems = "center",
  justifyContent = "center",
  ...props
}: EmptyStateProps) {
  return <Stack gap={gap} alignItems={alignItems} justifyContent={justifyContent} {...props} />;
}

export interface EmptyStateIconProps extends HStackProps {}

export function EmptyStateIcon({
  children,
  alignSelf = "center",
  justifyContent = "center",
  ...props
}: EmptyStateIconProps) {
  return (
    <HStack alignSelf={alignSelf} justifyContent={justifyContent} {...props}>
      {typeof children === "string" || typeof children === "number" ? (
        <Text variant="muted">{children}</Text>
      ) : (
        children
      )}
    </HStack>
  );
}

export interface EmptyStateTitleProps extends TextProps {}

export function EmptyStateTitle({
  variant = "heading",
  textAlign = "center",
  ...props
}: EmptyStateTitleProps) {
  return <Text variant={variant} textAlign={textAlign} {...props} />;
}

export interface EmptyStateDescriptionProps extends TextProps {}

export function EmptyStateDescription({
  variant = "muted",
  width = "100%",
  maxWidth = 60,
  textAlign = "center",
  ...props
}: EmptyStateDescriptionProps) {
  return (
    <Text variant={variant} width={width} maxWidth={maxWidth} textAlign={textAlign} {...props} />
  );
}

export interface EmptyStateActionsProps extends HStackProps {}

export function EmptyStateActions({
  gap = 1,
  alignSelf = "center",
  justifyContent = "center",
  ...props
}: EmptyStateActionsProps) {
  return <HStack gap={gap} alignSelf={alignSelf} justifyContent={justifyContent} {...props} />;
}
