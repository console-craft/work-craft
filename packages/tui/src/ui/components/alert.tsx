import { createContext, useContext } from "react";

import { symbols } from "@/ui/icons/symbols";
import type { HStackProps } from "@/ui/primitives/hstack";
import { HStack } from "@/ui/primitives/hstack";
import type { StackProps } from "@/ui/primitives/stack";
import { Stack } from "@/ui/primitives/stack";
import type { TextProps } from "@/ui/primitives/text";
import { Text } from "@/ui/primitives/text";

export type AlertStatus = "info" | "success" | "warning" | "error";

const alertSymbols = {
  info: symbols.info,
  success: symbols.check,
  warning: symbols.exclamation,
  error: symbols.crossBig,
} satisfies Record<AlertStatus, string>;

interface AlertContextValue {
  status: AlertStatus;
}

const AlertContext = createContext<AlertContextValue | null>(null);

function useAlert() {
  const context = useContext(AlertContext);

  if (!context) {
    throw new Error("Alert components must be used within <Alert>");
  }

  return context;
}

export interface AlertProps extends HStackProps {
  status?: AlertStatus;
}

export function Alert({ children, status = "info", ...props }: AlertProps) {
  return (
    <AlertContext.Provider value={{ status }}>
      <HStack border borderColor={status} paddingX={1} gap={1} alignItems="flex-start" {...props}>
        <Text fg={status}>{alertSymbols[status]}</Text>

        {children}
      </HStack>
    </AlertContext.Provider>
  );
}

export interface AlertContentProps extends StackProps {}

export function AlertContent(props: AlertContentProps) {
  return <Stack flexGrow={1} gap={0} {...props} />;
}

export interface AlertTitleProps extends TextProps {}

export function AlertTitle(props: AlertTitleProps) {
  const { status } = useAlert();

  return <Text variant="heading" fg={status} {...props} />;
}

export interface AlertDescriptionProps extends TextProps {}

export function AlertDescription(props: AlertDescriptionProps) {
  return <Text fg="foreground" {...props} />;
}
