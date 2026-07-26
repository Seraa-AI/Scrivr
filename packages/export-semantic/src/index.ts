// NOTE: the `FormatHandlers` "semantic" key augmentation is intentionally NOT
// side-effect-imported here. Importing this package for its runtime (e.g.
// @scrivr/plugins' AiToolkit) must not drag the `semantic` key into the
// consumer's addExports() type space — that would break the empty-map leniency
// other extensions rely on. Extensions that WRITE semantic handlers opt in with
//   import "@scrivr/export-semantic/augment";
export { toSemanticUnits } from "./toSemanticUnits";
export { SemanticExport } from "./SemanticExport";
export { unitEmbeddingInput, unitContentHash, unitRichHash, diffSemanticUnits } from "./changeDetection";
export type { SemanticUnitDiff } from "./changeDetection";
export type {
  SemanticUnit,
  SemanticUnitType,
  SemanticRole,
  SemanticTextView,
  SemanticChange,
  InlineSpan,
  InlineMark,
  TableCells,
  TableCellsRow,
  TableCell,
  SemanticNodeResult,
  SemanticNodeHandler,
  SemanticMarkHandler,
  SemanticRun,
  SemanticHandlers,
  SemanticExportOptions,
  UnitCtx,
} from "@scrivr/core";
