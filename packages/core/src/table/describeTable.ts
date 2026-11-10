import type { Node } from "prosemirror-model";

/** A table's size and whether its first row is a header — what its peek shows. */
export interface TableShape {
  rows: number;
  /** Widest row, counting `gridSpan`. */
  columns: number;
  /** True when every cell of the first row is a header cell. */
  headerRow: boolean;
}

export function describeTable(table: Node): TableShape {
  let columns = 0;
  table.forEach((row) => {
    let span = 0;
    row.forEach((cell) => {
      const gridSpan: unknown = cell.attrs["gridSpan"];
      span += typeof gridSpan === "number" ? gridSpan : 1;
    });
    columns = Math.max(columns, span);
  });
  const first = table.firstChild;
  let headerRow = first !== null && first.childCount > 0;
  first?.forEach((cell) => {
    if (cell.type.name !== "tableHeader") headerRow = false;
  });
  return { rows: table.childCount, columns, headerRow };
}
