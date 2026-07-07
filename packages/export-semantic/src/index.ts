// Side-effect: augments FormatHandlers with the "semantic" key.
import "./augmentation";

export { toSemanticUnits } from "./toSemanticUnits";
export { SemanticExport } from "./SemanticExport";
export { unitEmbeddingInput, unitContentHash, diffSemanticUnits } from "./changeDetection";
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
