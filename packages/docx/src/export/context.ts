/**
 * DOCX export context — re-exported from `@scrivr/core`.
 *
 * The canonical type definitions live in `@scrivr/core/exports/docx` so
 * built-in extensions can contribute via `addExports().docx` without a
 * runtime dependency on this package. This file is a thin re-export so
 * existing consumers using `import { DocxContext } from "@scrivr/docx"`
 * still resolve to the same types.
 */

export type {
  XmlNode,
  XmlAttrs,
  XmlChild,
  DocxPackage,
  DocxPackagePart,
  DocxStyleSpec,
  DocxNumberingLevel,
  DocxMediaPart,
  DocxUnsupportedPolicy,
  DocxFidelity,
  DocxResolvedOptions,
  DocxContext,
} from "@scrivr/core";
