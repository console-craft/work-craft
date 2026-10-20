import { type ReactNode } from "react";

import { Card, CardContent } from "@/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { ScrollArea } from "@/ui/primitives/scroll-area";
import { Text } from "@/ui/primitives/text";

export function TabsDemo(): ReactNode {
  const logs = [
    { id: 1, message: "Log 1" },
    { id: 2, message: "Log 2" },
    { id: 3, message: "Log 3" },
    { id: 4, message: "Log 4" },
    { id: 5, message: "Log 5" },
    { id: 6, message: "Log 6" },
    { id: 7, message: "Log 7" },
    { id: 8, message: "Log 8" },
    { id: 9, message: "Log 9" },
    { id: 10, message: "Log 10" },
    { id: 11, message: "Log 11" },
    { id: 12, message: "Log 12" },
    { id: 13, message: "Log 13" },
    { id: 14, message: "Log 14" },
    { id: 15, message: "Log 15" },
    { id: 16, message: "Log 16" },
    { id: 17, message: "Log 17" },
    { id: 18, message: "Log 18" },
    { id: 19, message: "Log 19" },
    { id: 20, message: "Log 20" },
    { id: 21, message: "Log 21" },
    { id: 22, message: "Log 22" },
    { id: 23, message: "Log 23" },
    { id: 24, message: "Log 24" },
    { id: 25, message: "Log 25" },
    { id: 26, message: "Log 26" },
    { id: 27, message: "Log 27" },
    { id: 28, message: "Log 28" },
    { id: 29, message: "Log 29" },
  ];

  return (
    <>
      <Text fg="primary">TABS</Text>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger disabled value="logs">
            Logs
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Text>Project overview</Text>
        </TabsContent>
        <TabsContent value="projects">
          <Text>Projects list</Text>
        </TabsContent>
        <TabsContent value="logs">
          <Text>Application logs</Text>
        </TabsContent>
        <TabsContent value="settings">
          <Text>Project settings</Text>
        </TabsContent>
      </Tabs>
      <Tabs id="tabs-overflow-demo" defaultValue="overview" width={40} maxWidth="100%">
        <TabsList id="tabs-overflow-list">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="implementation">Implementation details</TabsTrigger>
          <TabsTrigger id="tabs-overflow-long" value="research">
            研究 workspace with a label longer than this viewport
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Text>Project overview</Text>
        </TabsContent>
        <TabsContent value="implementation">
          <Text>Implementation details</Text>
        </TabsContent>
        <TabsContent value="research">
          <Text>Research workspace</Text>
        </TabsContent>
      </Tabs>
      <Card
        id="card-tabs-demo"
        width={60}
        height={20}
        gap={0}
        bg="secondary"
        border={false}
        padding={0}
      >
        <CardContent paddingX={0} flexGrow={1} minHeight={0}>
          <Tabs defaultValue="overview" flexGrow={1}>
            <TabsList>
              <TabsTrigger
                value="overview"
                bg="accent"
                flexGrow={1}
                flexBasis={0}
                justifyContent="center"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="logs"
                bg="accent"
                flexGrow={1}
                flexBasis={0}
                justifyContent="center"
              >
                Logs
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                bg="accent"
                flexGrow={1}
                flexBasis={0}
                justifyContent="center"
              >
                Settings
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" paddingX={1}>
              <Text>Status: healthy</Text>
              <Text>Branch: main</Text>
            </TabsContent>
            <TabsContent value="logs" flexGrow={1} minHeight={0}>
              <ScrollArea focusable flexGrow={1} minHeight={0} paddingX={1}>
                {logs.map((log) => (
                  <Text key={log.id}>{log.message}</Text>
                ))}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="settings" paddingX={1}>
              <Text>Coming soon</Text>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}
