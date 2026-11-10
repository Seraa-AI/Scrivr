---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A node can lay itself out as a composite — units placed one at a time, each
of side-by-side regions — through `layout: { kind: "composite", composite }`.
Tables now lay out this way (each row a unit, each cell a region) and look,
paginate, hit-test, export and copy exactly as before; the engine no longer
knows what a table is.

- New: `CompositeLayout`, `CompositeUnit`, `RegionPlacement`, `RegionInset`,
  `LaidRegion`, `RegionFloat`, `regionAtCoords`; `LayoutBlock.regions`,
  `unitData`, `lastUnit`.
- A composite unit's block strategy and PDF handler draw only its decoration;
  the engine paints and exports what its regions hold.

**Breaking:**

- `LayoutBlockKind` `"tableRow"` is `"composite"`; `LayoutBlock.cells` is
  `regions`, `isLastRow` is `lastUnit`; `CellSubBlock` and `CellFloat` are
  `LaidRegion` and `RegionFloat` (a region's `pos`, `inset` and `data`, where a
  cell's merge and background now live).
- `AnchoredObjectPlacement.cellPos` is `regionPos`.
- `BlockLayoutOptions.tableColumns` is removed (a unit carries its own data).
- `TableRowStrategy`, `TableLayoutEngine` and `cellAtCoords` are removed from
  core's layout and renderer.
