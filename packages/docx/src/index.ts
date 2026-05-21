// Side-effect: augments FormatHandlers with the "docx" key.
import "./augmentation";

// ── Export side ─────────────────────────────────────────────────────────────

export { exportDocx, exportDocxBytes } from "./export/export";
export type { DocxExportOptions, DocxExportResult } from "./export/export";

export { DocxExport } from "./export/DocxExport";

export { DocxExportError } from "./export/error";

export type {
  DocxNodeHandler,
  DocxMarkHandler,
  DocxNodeMeta,
  DocxRunProps,
  DocxDiagnostic,
  DocxDiagnosticLevel,
  DocxHandlers,
} from "./export/handlers";

export type {
  DocxContext,
  DocxPackage,
  DocxPackagePart,
  DocxMediaPart,
  DocxStyleSpec,
  DocxNumberingLevel,
  DocxUnsupportedPolicy,
  DocxFidelity,
  DocxResolvedOptions,
  XmlNode,
} from "./export/context";

export { xml, serializeXml } from "./export/xml";
export type { XmlAttrs, XmlChild, SerializeOptions } from "./export/xml";

export { zipDocxPackage } from "./export/package";
export type { ZipDocxOptions, ZipCompressionLevel } from "./export/package";

// Lower-level building blocks — exported for advanced callers and tests.
// Most consumers should only need `exportDocx` / `exportDocxBytes`.
export { walkDocument } from "./export/walker";
export { createDocxContext } from "./export/createContext";
export { buildDocxPackage } from "./export/defaults";

// ── Import side ─────────────────────────────────────────────────────────────
//
// Coming online module-by-module — see src/import/. Public surface
// (`importDocx`, `DocxImportError`, `DocxImports`, ...) lands as each
// milestone ships.
