/**
 * DOCX import entry point — reads an OPC package and returns ProseMirror
 * JSON conforming to the consumer's schema.
 *
 * Pipeline:
 *   1. Unzip OPC bytes (`readDocxPackage`).
 *   2. Parse `word/document.xml` (`parseOoxml`).
 *   3. Walk into the normalized intermediate model (`parseDocumentBody`).
 *   4. Transform to ProseMirror JSON (`transformToProseMirror`).
 *
 * Returns `{ doc, diagnostics }` so consumers can surface fidelity warnings
 * ("imported with 3 warnings: unsupported field code dropped, ..."). Fatal
 * failures throw `DocxImportError` with the same diagnostics attached.
 *
 * MVP scope: paragraph + text. Marks/headings/lists/images each ship in
 * subsequent commits per the milestone plan.
 */

import { readDocxPackage } from "./opc";
import { parseOoxml } from "./xml";
import { parseDocumentBody } from "./parser";
import {
  transformToProseMirror,
  type PmDocJson,
} from "./transform";
import {
  createDocxImportContext,
  type DocxImportOptions,
} from "./context";
import { DocxImportError } from "./error";
import type { DocxDiagnostic } from "@scrivr/core";

export interface DocxImportResult {
  doc: PmDocJson;
  diagnostics: DocxDiagnostic[];
}

export async function importDocx(
  bytes: Uint8Array,
  options: DocxImportOptions = {},
): Promise<DocxImportResult> {
  const ctx = createDocxImportContext(options);
  try {
    const pkg = readDocxPackage(bytes);
    const documentXml = pkg.readText("word/document.xml");
    if (documentXml === undefined) {
      throw new DocxImportError(
        "Invalid DOCX: missing word/document.xml",
        ctx.diagnostics.list(),
      );
    }
    const root = parseOoxml(documentXml);
    if (!root || root.name !== "w:document") {
      throw new DocxImportError(
        "Invalid DOCX: word/document.xml does not start with <w:document>",
        ctx.diagnostics.list(),
      );
    }
    const model = parseDocumentBody(root);
    const doc = transformToProseMirror(model);
    return { doc, diagnostics: ctx.diagnostics.list() };
  } catch (err) {
    if (err instanceof DocxImportError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new DocxImportError(message, ctx.diagnostics.list());
  }
}

export type { DocxImportOptions };
export type { PmDocJson } from "./transform";
