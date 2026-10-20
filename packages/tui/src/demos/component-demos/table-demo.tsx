import { type ReactNode, useState } from "react";

import { Badge } from "@/ui/components/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/table";
import { Button } from "@/ui/controls/button";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Stack } from "@/ui/primitives/stack";
import { Text } from "@/ui/primitives/text";

export function TableDemo(): ReactNode {
  const [selected, setSelected] = useState<number | null>(null);
  const longError =
    "Failed to initialize the runtime: an unexpected dependency resolution failure in @app/core/runtime. Retry after updating the configuration.";
  const services = [
    { name: "Client", status: "Healthy", latency: "12ms" },
    {
      name: "Server",
      status: "Error",
      latency: "31ms",
    },
    { name: "DB", status: "Healthy", latency: "42ms" },
    { name: "Worker", status: "Healthy", latency: "32ms" },
  ];

  return (
    <Stack maxWidth={80} gap={2}>
      <Table columns={[30, null, 20]}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead textAlign="right">Latency</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.name}>
              <TableCell>{service.name}</TableCell>
              <TableCell>{service.status}</TableCell>
              <TableCell textAlign="right">{service.latency}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Table columns={[30, null, 20]} border="none" bg="secondary" striped>
        <TableHeader bg="primary">
          <TableRow>
            <TableHead variant="default" fg="primaryForeground">
              Name
            </TableHead>
            <TableHead variant="default" fg="primaryForeground">
              Status
            </TableHead>
            <TableHead variant="default" fg="primaryForeground" textAlign="right">
              Latency
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.name}>
              <TableCell>{service.name}</TableCell>
              <TableCell>{service.status}</TableCell>
              <TableCell textAlign="right">{service.latency}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Table id="table-wrap-demo" columns={[30, null, 20]} border="full" borderColor="focus">
        <TableHeader>
          <TableRow>
            <TableHead fg="primary">Name</TableHead>
            <TableHead fg="primary">Status</TableHead>
            <TableHead fg="primary" textAlign="right">
              Latency
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.name}>
              <TableCell>{service.name}</TableCell>
              <TableCell>{service.name === "Server" ? longError : service.status}</TableCell>
              <TableCell textAlign="right">{service.latency}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ScrollArea
        height={13}
        scrollY={false}
        scrollX
        scrollbarTrackColor="secondary"
        border
        paddingX={1}
      >
        <Table columns={[10, null, 10]} wrap={false} width={180}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead textAlign="right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => (
              <TableRow key={service.name}>
                <TableCell>{service.name}</TableCell>
                <TableCell>{service.name === "Server" ? longError : service.status}</TableCell>
                <TableCell textAlign="right">{service.latency}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <Card gap={0}>
        <CardHeader bg="muted">
          <CardTitle>Packages</CardTitle>
        </CardHeader>
        <CardContent paddingX={0}>
          <ScrollArea
            id="table-scroll-demo"
            height={8}
            focusable
            keyboardFallback
            padding={1}
            scrollbarTrackColor="secondary"
          >
            <Table
              id="table-scroll-content"
              columns={[null, null, 25]}
              wrap={false}
              bg="background"
            >
              <TableHeader>
                <TableRow>
                  <TableHead>Build</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 12 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell>Package {index + 1}</TableCell>
                    <TableCell>
                      {index === 2 ? (
                        <Badge color="error">Failed</Badge>
                      ) : (
                        <Badge color="success">Ready</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" onPress={() => setSelected(index + 1)}>
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
        <CardFooter>
          <Text variant="muted">
            {selected === null
              ? "Tab to a build action and press Enter."
              : `Inspecting package ${selected}`}
          </Text>
        </CardFooter>
      </Card>
    </Stack>
  );
}
