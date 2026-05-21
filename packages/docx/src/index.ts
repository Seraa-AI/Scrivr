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

export { importDocx } from "./import/import";
export type { DocxImportResult, DocxImportOptions } from "./import/import";

export { DocxImport } from "./import/DocxImport";

export { DocxImportError } from "./import/error";

export { createDocxImportContext } from "./import/context";
export type {
  DocxImportContext,
  DocxImportResolvedOptions,
  DocxMediaSink,
} from "./import/context";

export type {
  DocxBlock,
  DocxInline,
  DocxMark,
  DocxParagraphAttrs,
  DocxImportModel,
} from "./import/types";

// Lower-level building blocks — exported for tests and extension parsers.
export { readDocxPackage } from "./import/opc";
export type { DocxPackageReader } from "./import/opc";
export {
  parseOoxml,
  findChild,
  findChildren,
  attr,
  textContent,
} from "./import/xml";
export type { OoxmlElement, OoxmlChild } from "./import/xml";
