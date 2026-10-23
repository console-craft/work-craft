import {
  ProtocolError,
  type Snapshot,
  type TerminalGeometry,
  type TerminalSize,
  type ViewerReport,
} from "../api/protocol.ts";
import { projectPaneLayout } from "./layout.ts";
import type { NavigationCatalog } from "./navigation.ts";

export type SizingCatalog = Omit<NavigationCatalog, "panes"> & Pick<Snapshot, "panes">;
export type GeometryDecision = {
  changed: boolean;
  geometry: TerminalGeometry;
  resizes: { paneId: string; size: TerminalSize }[];
};
export type TerminalSizing = {
  report(connectionId: string, report: ViewerReport | null): GeometryDecision;
  activity(connectionId: string, sequence: number): GeometryDecision;
  attachmentActivity(connectionId: string): GeometryDecision;
  remove(connectionId: string): GeometryDecision;
  reconcile(catalog: SizingCatalog): GeometryDecision;
  current(): TerminalGeometry;
  spawnSize(paneId: string): TerminalSize;
};
type Viewer = { report: ViewerReport | null; order: number; sequence: number };

function sameSize(
  first: TerminalSize | null | undefined,
  second: TerminalSize | null | undefined,
): boolean {
  return first?.cols === second?.cols && first?.rows === second?.rows;
}

function validateCanvas(size: TerminalSize): void {
  if (
    ![size.cols, size.rows].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 4096,
    ) ||
    size.cols * size.rows > 1_048_576
  ) {
    throw new ProtocolError("canvas dimensions must be positive bounded integers");
  }
}

function projectedGrids(catalog: SizingCatalog, report: ViewerReport, startingPaneId?: string) {
  const tab = catalog.tabs.find(({ id }) => id === report.tabId);
  return projectPaneLayout(tab?.layout ?? null, {
    x: 0,
    y: 0,
    width: report.canvas.cols,
    height: report.canvas.rows,
  })
    .panes.filter(
      ({ paneId, rect }) =>
        catalog.panes.some(
          (pane) =>
            pane.id === paneId &&
            pane.surfaceId === tab?.surfaceId &&
            (pane.processStatus === "running" || pane.id === startingPaneId),
        ) &&
        rect.width >= 20 &&
        rect.height - 1 >= 5,
    )
    .map(({ paneId, rect }) => ({ paneId, size: { cols: rect.width, rows: rect.height - 1 } }));
}

/** In-memory arbitration only: callers authorize viewers and apply the returned runtime effects. */
export function createTerminalSizing(initial: SizingCatalog): TerminalSizing {
  let catalog = initial;
  const viewers = new Map<string, Viewer>();
  let activityOrder = 0;
  let geometry: TerminalGeometry = {
    sequence: 0,
    tabs: catalog.tabs.map(({ id }) => ({
      tabId: id,
      generation: 0,
      ownerConnectionId: null,
      canvas: null,
    })),
    panes: catalog.panes.map(({ id }) => ({ paneId: id, size: { cols: 80, rows: 24 } })),
  };

  function viewer(connectionId: string): Viewer {
    let value = viewers.get(connectionId);
    if (value === undefined) {
      value = { report: null, order: 0, sequence: 0 };
      viewers.set(connectionId, value);
    }
    return value;
  }

  function refresh(): GeometryDecision {
    const sizes = new Map(
      catalog.panes.map(({ id }) => [
        id,
        geometry.panes.find(({ paneId }) => paneId === id)?.size ?? { cols: 80, rows: 24 },
      ]),
    );
    const tabs = catalog.tabs.map((tab) => {
      const candidates = [...viewers].filter(
        ([, value]) =>
          value.order > 0 &&
          value.report?.tabId === tab.id &&
          value.report.eligible &&
          value.report.canvas.cols >= 60 &&
          value.report.canvas.rows >= 6 &&
          projectedGrids(catalog, value.report).length > 0,
      );
      candidates.sort((a, b) => b[1].order - a[1].order);
      const owner = candidates[0];
      const previous = geometry.tabs.find(({ tabId }) => tabId === tab.id);
      const canvas = owner?.[1].report?.canvas ?? previous?.canvas ?? null;
      let gridChanged = false;
      if (owner?.[1].report) {
        for (const { paneId, size } of projectedGrids(catalog, owner[1].report)) {
          gridChanged ||= !sameSize(sizes.get(paneId), size);
          sizes.set(paneId, size);
        }
      }
      const ownerConnectionId = owner?.[0] ?? null;
      const changed =
        gridChanged ||
        ownerConnectionId !== (previous?.ownerConnectionId ?? null) ||
        !sameSize(canvas, previous?.canvas);
      return {
        tabId: tab.id,
        generation: (previous?.generation ?? 0) + Number(changed),
        ownerConnectionId,
        canvas,
      };
    });
    const panes = [...sizes].map(([paneId, size]) => ({ paneId, size }));
    const resizes = panes.filter(
      (pane) =>
        !sameSize(geometry.panes.find(({ paneId }) => paneId === pane.paneId)?.size, pane.size),
    );
    const changed =
      resizes.length > 0 ||
      panes.length !== geometry.panes.length ||
      tabs.length !== geometry.tabs.length ||
      tabs.some((tab, index) => {
        const previous = geometry.tabs[index];
        return (
          previous?.tabId !== tab.tabId ||
          previous.ownerConnectionId !== tab.ownerConnectionId ||
          !sameSize(previous.canvas, tab.canvas)
        );
      });
    if (changed) {
      geometry = { sequence: geometry.sequence + 1, tabs, panes };
    }
    return { changed, geometry, resizes };
  }

  return {
    spawnSize(paneId) {
      const candidates = [...viewers.values()]
        .filter(
          ({ report, order }) =>
            order > 0 &&
            report?.eligible &&
            report.canvas.cols >= 60 &&
            report.canvas.rows >= 6 &&
            projectedGrids(catalog, report, paneId).some((pane) => pane.paneId === paneId),
        )
        .sort((a, b) => b.order - a.order);
      const report = candidates[0]?.report;
      return (
        (report &&
          projectedGrids(catalog, report, paneId).find((pane) => pane.paneId === paneId)?.size) ||
        geometry.panes.find((pane) => pane.paneId === paneId)?.size || { cols: 80, rows: 24 }
      );
    },
    report(connectionId, report) {
      if (report !== null) {
        validateCanvas(report.canvas);
        if (!catalog.tabs.some(({ id }) => id === report.tabId)) {
          throw new ProtocolError("canvas tab not found");
        }
      }
      viewer(connectionId).report =
        report === null ? null : { ...report, canvas: { ...report.canvas } };
      return refresh();
    },
    activity(connectionId, sequence) {
      const value = viewer(connectionId);
      if (!Number.isSafeInteger(sequence) || sequence <= value.sequence) {
        return { changed: false, geometry, resizes: [] };
      }
      value.sequence = sequence;
      value.order = ++activityOrder;
      return refresh();
    },
    attachmentActivity(connectionId) {
      viewer(connectionId).order = ++activityOrder;
      return refresh();
    },
    remove(connectionId) {
      viewers.delete(connectionId);
      return refresh();
    },
    reconcile(next) {
      catalog = next;
      return refresh();
    },
    current: () => geometry,
  };
}
