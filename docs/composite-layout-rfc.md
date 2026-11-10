# Composite layout: tables owned by their extension

Status: Draft (2026-11-10), for sign-off.

## Problem

The engine-declarations RFC took every other node name out of layout. Tables
are what is left, and they are the deepest: the engine lays a table out as a
table.

| Where | What it knows |
|---|---|
| `layout/layoutItems.ts` | A node named `table` expands into its rows; its `grid` attr becomes `tableColumns`; the last row is `isLastRow` |
| `layout/BlockLayout.ts` | `"tableRow"` is a `LayoutBlockKind`; a node named `tableRow` is laid out by `layoutTableRow`; `CellSubBlock` (cellPos, vMerge, background, floats); CharacterMap population walks `cells` |
| `layout/PageLayout.ts` | `cells`, `isLastRow`, `tableColumns` on items, flows and blocks; rows bypass the measure cache by name; images in cells are collected from `cells` |
| `layout/FlowPlacement.ts`, `AnchoredObjectSolver.ts` | `kind === "tableRow"` is atomic |
| `layout/cellHitTest.ts`, `renderer/PointerController.ts` | Hit-testing and drops find a cell inside a `tableRow` block |
| `renderer/TableRowStrategy.ts` | The row painter lives in the engine's renderer |
| `input/ClipboardSerializer.ts` | A cell selection serializes a node named `table` |

So a table is not an extension in the sense lists, breaks, floats and outlines
now are: a different kind of grid (a layout table, a form, a two-column
comparison block) would need engine changes.

## The future this lands into

The resumable-layout RFC (`docs/resumable-layout-rfc.md`) already names the
shape: a table is a **producer**. A region cursor offers a region; the table
producer offers each unfinished cell a nested region, the row accepts all cell
results together, and a row may split across pages (its Phase 5). This RFC
does not build resumable producers. It moves the table onto a declaration
whose shape that producer will take, so the engine stops knowing tables now
and row splitting later changes one function, not the engine's vocabulary.

## Design

### 1. A node declares that it is composite

```ts
type NodeLayout =
  | { kind: "block" }
  | { kind: "transparent"; wrap?: WrapperLayout }
  | { kind: "break"; breaks: BreakKind }
  | { kind: "composite"; composite: CompositeLayout };

interface CompositeLayout {
  /** The units pagination places one at a time, in order: a table's rows. */
  units(node: Node, pos: number): CompositeUnit[];
  /** Lay one unit out at a width: its height, and the regions it holds. */
  layoutUnit(unit: CompositeUnit, ctx: UnitLayoutContext): LaidUnit;
}

interface CompositeUnit { node: Node; pos: number; data: unknown }

interface UnitLayoutContext {
  x: number;
  width: number;
  /** Lay a node's child blocks out in a nested region, by the engine's own flow. */
  layoutRegion(node: Node, pos: number, region: { x: number; width: number }): { blocks: LayoutBlock[]; height: number };
}

interface LaidUnit {
  height: number;
  regions: LaidRegion[];
  /** The extension's own, for its painter and exporters: a row's borders, shading, merges. */
  data: unknown;
}

interface LaidRegion {
  pos: number;            // the region's node (a cell)
  x: number; y: number;   // y relative to the unit's top
  width: number; height: number;
  blocks: LayoutBlock[];
  floats?: RegionFloat[]; // today's CellFloat, renamed
}
```

- **The walk** emits one item per unit for a composite node, instead of
  expanding a node named `table`. `tableColumns` and `isLastRow` become unit
  `data` the Table extension computes.
- **Region layout stays the engine's.** `layoutRegion` runs the same item
  collection and measurement a page body uses (it is today's sandboxed cell
  layout, `layoutTableRowCells`' inner loop), so an extension never measures
  text, and every block a cell holds lays out as it does anywhere else.
- **`LayoutBlockKind` becomes `"text" | "leaf" | "composite"`**, and a block
  carries `regions` and `unitData` in place of `cells` and `isLastRow`.
- **A composite unit is atomic** for now, as a row is today: it moves to the
  next page whole. A unit's break policy (`atomic` / `splittable`) is where
  resumable layout Phase 5 attaches row splitting.

### 2. What becomes generic in the engine

| Today | After |
|---|---|
| CharacterMap populated from `cells` | From `regions` |
| Images in cells, collected from `cells` | From `regions[].floats` |
| `cellAtCoords` (hit-testing a cell) | `regionAtCoords`; the Table's cell selection maps a region back to its cell |
| `PointerController.cellAt` (drops into a cell) | `regionAt` |
| `kind === "tableRow"` atomic in pagination and the solver | `kind === "composite"` |
| Rows bypass the measure cache by name | Composite units bypass it by kind |
| `TableRowStrategy` in `renderer/` | In the Table extension, reading `unitData` and `regions` |
| Cell selection serializing a node named `table` | The selection serializes its own content (a `CellSelection` method) |

### 3. What the Table extension owns after

The grid (`grid` attr → column widths), cell padding and borders, merges
(`vMerge`, `gridSpan`), background, the last-row edge, the row painter (canvas
and PDF, which already lives in `table/pdfExport.ts`), and cell selection.

## Public API

Breaking, during beta (patch changesets):

- Removed: `LayoutBlockKind` `"tableRow"`, `CellSubBlock`, `CellFloat`,
  `LayoutBlock.cells` / `isLastRow`, `BlockLayoutOptions.tableColumns`,
  `layoutTableRow`, `TableRowStrategy` from core's renderer exports,
  `cellAtCoords`.
- New: `NodeLayout`'s `composite`, `CompositeLayout`, `CompositeUnit`,
  `UnitLayoutContext`, `LaidUnit`, `LaidRegion`, `RegionFloat`;
  `LayoutBlock.regions` / `unitData`; `regionAtCoords`.

## How it is checked

As before: every existing table test keeps its assertions (layout, paint, PDF,
DOCX, selection, clipboard, floats in cells); only names change. A test-only
extension written against the public API declares a different composite — a
two-column comparison block, one unit per pair, two regions each — and lays
out, paints, hit-tests and exports with no engine change. The vocabulary
guards keep `table`, `tableRow`, `tableCell` and `tableHeader` out of
`layout/`, `renderer/` and `input/`.

## Decisions for sign-off

1. **The vocabulary**: `composite` / units / regions, rather than keeping
   rows and cells in the engine under generic types.
2. **Atomic units only in this PR.** Row splitting waits for resumable
   layout's producer phases; the unit's break policy is where it attaches.
3. **Region layout stays engine-owned** (`layoutRegion`), so extensions place
   regions and the engine lays out what they hold.
4. **One PR**, as the earlier phases.

## What shipped

Nothing yet.
