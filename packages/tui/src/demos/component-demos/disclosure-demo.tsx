import { type ReactNode } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/ui/components/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/components/collapsible";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export function DisclosureDemo(): ReactNode {
  return (
    <>
      <Text fg="primary">COLLAPSIBLE</Text>
      <Collapsible>
        <CollapsibleTrigger>Advanced settings</CollapsibleTrigger>
        <CollapsibleContent paddingLeft={3}>
          <Text>Timeout: 30s</Text>
          <Text>Retries: 3</Text>
        </CollapsibleContent>
      </Collapsible>

      <Text fg="primary">ACCORDIONS</Text>
      <Accordion defaultValue="general" width={40}>
        <AccordionItem value="general">
          <AccordionTrigger>General</AccordionTrigger>
          <AccordionContent>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
            <Text>Prompt engineering is just arguing with probability distributions.</Text>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="appearance">
          <AccordionTrigger>Appearance</AccordionTrigger>
          <AccordionContent>
            <ScrollArea focusable height={10} paddingRight={2}>
              <Stack>
                <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
                <Text>Prompt engineering is just arguing with probability distributions.</Text>
                <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
                <Text>Prompt engineering is just arguing with probability distributions.</Text>
                <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
                <Text>Prompt engineering is just arguing with probability distributions.</Text>
              </Stack>
            </ScrollArea>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="experimental" disabled>
          <AccordionTrigger>Experimental</AccordionTrigger>
          <AccordionContent>
            <Text>The model confidently hallucinated a perfectly plausible mistake.</Text>
            <Text>Prompt engineering is just arguing with probability distributions.</Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}
