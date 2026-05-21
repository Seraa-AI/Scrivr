// Side-effect: augments FormatHandlers with the "docx" key.
import "./augmentation";

export { exportDocx, exportDocxBytes } from "./export";
export type { DocxExportOptions, DocxExportResult } from "./export";

export { DocxExportError } from "./error";

export type {
  DocxNodeHandler,
  DocxMarkHandler,
  DocxNodeMeta,
  DocxRunProps,
  DocxDiagnostic,
  DocxDiagnosticLevel,
  DocxHandlers,
} from "./handlers";

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
} from "./context";

export { xml, serializeXml } from "./xml";
export type { XmlAttrs, XmlChild, SerializeOptions } from "./xml";

export { zipDocxPackage } from "./package";
export type { ZipDocxOptions, ZipCompressionLevel } from "./package";

// Lower-level building blocks — exported for advanced callers and tests.
// Most consumers should only need `exportDocx` / `exportDocxBytes`.
export { walkDocument } from "./walker";
export { createDocxContext } from "./createContext";
export { buildDocxPackage } from "./defaults";
