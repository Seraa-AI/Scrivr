// Side-effect: augments FormatHandlers with the "docx" key.
import "./augmentation";

export type { DocxNodeHandler, DocxMarkHandler, DocxHandlers } from "./handlers";
export type {
  DocxContext,
  DocxPackage,
  DocxStyleSpec,
  DocxNumberingLevel,
  XmlNode,
} from "./context";
export { exportDocx } from "./export";
export type { DocxExportOptions } from "./export";
