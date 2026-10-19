import {
  BorderChars,
  type BoxRenderable,
  type OptimizedBuffer,
  type Renderable,
} from "@opentui/core";
import {
  Children,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

import { Box, type BoxProps } from "@/ui/primitives/box";
import { Text, type TextProps } from "@/ui/primitives/text";
import type { ThemeColor } from "@/ui/theme";
import { getContentWidth, isTextContent } from "@/ui/utils";

export type TableBorder = "none" | "minimal" | "full";
export type TableColumnWidth = number | null;

type TableContextValue = {
  columns?: readonly TableColumnWidth[];
  wrap: boolean;
  border: TableBorder;
  striped: boolean;
  borderColor: BoxProps["borderColor"];
  borderStyle: BoxProps["borderStyle"];
};

const TableContext = createContext<TableContextValue | null>(null);

/** Join native box borders using the laid-out columns, including after a resize. */
function drawColumnJunctions(
  buffer: OptimizedBuffer,
  box: BoxRenderable,
  row: Renderable | undefined,
  y: number,
  junction: "topT" | "bottomT" | "cross",
): void {
  const chars = box.customBorderChars ?? BorderChars[box.borderStyle];
  for (const column of (row?.getChildren() ?? []) as BoxRenderable[]) {
    if (
      column.visible &&
      Array.isArray(column.border) &&
      column.border.includes("left") &&
      column.x > box.x &&
      column.x < box.x + box.width - 1
    ) {
      buffer.drawText(chars[junction], column.x, y, box.borderColor);
    }
  }
}

function drawFrameJunctions(
  box: BoxRenderable,
  buffer: OptimizedBuffer,
  title?: string,
  bottomTitle?: string,
): void {
  const sections = box.getChildren() as BoxRenderable[];
  const rows = sections.flatMap((section) => section.getChildren()) as BoxRenderable[];
  if (!title) {
    drawColumnJunctions(buffer, box, rows[0], box.y, "topT");
  }
  if (!bottomTitle) {
    drawColumnJunctions(buffer, box, rows[0], box.y + box.height - 1, "bottomT");
  }
  const chars = box.customBorderChars ?? BorderChars[box.borderStyle];
  for (const part of [...sections, ...rows]) {
    if (!Array.isArray(part.border)) {
      continue;
    }
    const y = part.border.includes("bottom")
      ? part.y + part.height - 1
      : part.border.includes("top")
        ? part.y
        : undefined;
    if (y !== undefined) {
      buffer.drawText(chars.leftT, box.x, y, box.borderColor);
      buffer.drawText(chars.rightT, box.x + box.width - 1, y, box.borderColor);
    }
  }
}

function columnWidths(columns: readonly TableColumnWidth[], width: number): number[] {
  const fixedTotal = columns.reduce<number>((sum, column) => sum + (column ?? 0), 0);
  const flexibleCount = columns.filter((column) => column === null).length;
  const flexibleWidth = flexibleCount > 0 ? (100 - fixedTotal) / flexibleCount : 0;
  let offset = 0;
  // Round shared boundaries, not individual widths: columns must exactly fill the row.
  return columns.map((column) => {
    const start = Math.round(offset);
    offset += (width * (column ?? flexibleWidth)) / 100;
    return Math.round(offset) - start;
  });
}

function useTable(component: string) {
  const context = useContext(TableContext);

  if (!context) {
    throw new Error(`${component} must be used within <Table>`);
  }

  return context;
}

type TableSection = "header" | "body";

type TableRowContextValue = {
  section: TableSection;
  index: number;
};

const TableRowContext = createContext<TableRowContextValue | null>(null);

function useTableRow(component: string) {
  const context = useContext(TableRowContext);

  if (!context) {
    throw new Error(`${component} must be used within <TableHeader> or <TableBody>`);
  }

  return context;
}

function validateColumns(columns: readonly TableColumnWidth[] | undefined) {
  if (columns === undefined) {
    return;
  }

  if (columns.length === 0) {
    throw new Error("Table columns must contain at least one column");
  }

  let explicitTotal = 0;
  let flexibleCount = 0;

  for (const column of columns) {
    if (column === null) {
      flexibleCount++;
      continue;
    }

    if (!Number.isFinite(column) || column <= 0 || column > 100) {
      throw new Error("Table column widths must be percentages greater than 0 and at most 100");
    }

    explicitTotal += column;
  }

  if (explicitTotal > 100) {
    throw new Error("Table column widths cannot exceed 100%");
  }

  if (flexibleCount === 0 && explicitTotal !== 100) {
    throw new Error("Table column widths must total 100% when no flexible columns are present");
  }

  if (flexibleCount > 0 && explicitTotal >= 100) {
    throw new Error("Table flexible columns require remaining width");
  }
}

export interface TableProps extends Omit<BoxProps, "children" | "flexDirection" | "border"> {
  children?: ReactNode;

  /**
   * Percentage-based column widths.
   *
   * `null` columns equally share the remaining width.
   *
   * @example
   * [10, null, null, 20] -> 10%, 35%, 35%, 20%
   */
  columns?: readonly TableColumnWidth[];

  /** Wrap simple textual cell content instead of truncating it. */
  wrap?: boolean;

  /** Controls table and cell separator rendering. */
  border?: TableBorder;

  /** Applies a different background to alternating body rows. */
  striped?: boolean;
}

export function Table({
  children,

  columns,
  wrap = true,
  border = "minimal",
  striped = false,

  width = "100%",
  borderColor,
  borderStyle,
  renderAfter,

  ...props
}: TableProps) {
  validateColumns(columns);

  const context = useMemo<TableContextValue>(
    () => ({
      columns,
      wrap,
      border,
      striped,
      borderColor,
      borderStyle,
    }),
    [columns, wrap, border, striped, borderColor, borderStyle],
  );

  return (
    <TableContext.Provider value={context}>
      <Box
        {...props}
        width={width}
        flexDirection="column"
        alignItems="stretch"
        gap={0}
        border={border === "full" ? true : []}
        borderColor={borderColor}
        borderStyle={borderStyle}
        renderAfter={function (buffer, deltaTime) {
          if (border === "full") {
            drawFrameJunctions(this, buffer, props.title, props.bottomTitle);
          }
          renderAfter?.call(this, buffer, deltaTime);
        }}
      >
        {children}
      </Box>
    </TableContext.Provider>
  );
}

interface TableSectionProps extends Omit<BoxProps, "children" | "flexDirection" | "gap"> {
  children?: ReactNode;
}

function TableRows({ children, section }: { children?: ReactNode; section: TableSection }) {
  return Children.toArray(children).map((child, index) => (
    <TableRowContext.Provider
      key={isValidElement(child) ? child.key : index}
      value={{ section, index }}
    >
      {child}
    </TableRowContext.Provider>
  ));
}

export interface TableHeaderProps extends TableSectionProps {}

export function TableHeader({ children, renderAfter, ...props }: TableHeaderProps) {
  const table = useTable("TableHeader");

  return (
    <Box
      {...props}
      flexDirection="column"
      alignItems="stretch"
      gap={0}
      border={table.border !== "none" ? ["bottom"] : []}
      borderColor={table.borderColor}
      borderStyle={table.borderStyle}
      renderAfter={function (buffer, deltaTime) {
        if (table.border === "full") {
          drawColumnJunctions(
            buffer,
            this,
            this.getChildren().at(-1),
            this.y + this.height - 1,
            "cross",
          );
        }
        renderAfter?.call(this, buffer, deltaTime);
      }}
    >
      <TableRows section="header">{children}</TableRows>
    </Box>
  );
}

export interface TableBodyProps extends TableSectionProps {}

export function TableBody({ children, ...props }: TableBodyProps) {
  useTable("TableBody");

  return (
    <Box {...props} flexDirection="column" alignItems="stretch" gap={0}>
      <TableRows section="body">{children}</TableRows>
    </Box>
  );
}

export interface TableRowProps extends Omit<
  BoxProps,
  "children" | "flexDirection" | "gap" | "border"
> {
  children?: ReactNode;
}

export function TableRow({
  children,
  bg,
  alignItems = "stretch",
  renderBefore,
  renderAfter,
  ...props
}: TableRowProps) {
  const table = useTable("TableRow");
  const row = useTableRow("TableRow");
  const [width, setWidth] = useState<number | null>(null);

  const cells = Children.toArray(children);

  if (table.columns !== undefined && cells.length !== table.columns.length) {
    throw new Error(
      `TableRow has ${cells.length} cells but Table defines ${table.columns.length} columns`,
    );
  }

  const striped = table.striped && row.section === "body" && row.index % 2 === 0;

  const separatorBefore = row.index > 0 && table.border !== "none";

  const widths = columnWidths(table.columns ?? cells.map(() => null), width ?? 0);
  const firstVisibleColumn = widths.findIndex((value) => value > 0);

  return (
    <Box
      {...props}
      flexDirection="row"
      alignItems={alignItems}
      gap={0}
      bg={bg ?? (striped ? "focus" : undefined)}
      border={separatorBefore ? ["top"] : []}
      borderColor={table.borderColor}
      borderStyle={table.borderStyle}
      renderBefore={function (buffer, deltaTime) {
        // Padding can change the usable width without emitting a native size-change event.
        const availableWidth = Math.round(getContentWidth(this));
        if (availableWidth !== width) {
          setWidth(availableWidth);
        }
        renderBefore?.call(this, buffer, deltaTime);
      }}
      renderAfter={function (buffer, deltaTime) {
        if (table.border === "full" && separatorBefore) {
          drawColumnJunctions(buffer, this, this, this.y, "cross");
        }
        renderAfter?.call(this, buffer, deltaTime);
      }}
    >
      {cells.map((cell, index) => (
        <Box
          key={index}
          minWidth={0}
          flexShrink={0}
          width={widths[index]}
          visible={width === null || widths[index]! > 0}
          overflow="hidden"
          alignSelf="stretch"
          border={
            table.border === "full" && index > firstVisibleColumn && widths[index]! > 0
              ? ["left"]
              : []
          }
          borderColor={table.borderColor}
          borderStyle={table.borderStyle}
        >
          {cell}
        </Box>
      ))}
    </Box>
  );
}

type TableTextAlign = TextProps["textAlign"];

export interface TableCellProps extends Omit<BoxProps, "children"> {
  children?: ReactNode;

  /**
   * Applies to simple textual children.
   * Composed children own their own alignment.
   */
  textAlign?: TableTextAlign;
  fg?: ThemeColor;
}

export function TableCell(props: TableCellProps) {
  return <TableCellContent {...props} />;
}

export interface TableHeadProps extends TableCellProps {}

export function TableHead({
  variant,
  ...props
}: TableHeadProps & { variant?: TextProps["variant"] }) {
  return <TableCellContent variant={variant ?? "label"} {...props} />;
}

function TableCellContent({
  children,
  variant,
  fg = "foreground",
  textAlign = "left",
  paddingX = 1,
  alignItems = "flex-start",
  ...props
}: TableCellProps & { variant?: TextProps["variant"] }) {
  const table = useTable(variant === "label" ? "TableHead" : "TableCell");

  return (
    <Box flexGrow={1} alignSelf="stretch" paddingX={paddingX} alignItems={alignItems} {...props}>
      {isTextContent(children) ? (
        <Text
          alignSelf="stretch"
          variant={variant}
          textAlign={textAlign}
          wrapMode={table.wrap ? "word" : "none"}
          truncate={!table.wrap}
          fg={fg}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Box>
  );
}
