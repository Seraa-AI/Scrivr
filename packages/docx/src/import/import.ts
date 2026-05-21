/**
 * DOCX import entry point — reads an OPC package and returns a ProseMirror
 * `Node` constructed against the editor's schema.
 *
 * Pipeline:
 *   1. Collect handlers via `editor.getImportContributions()` + overrides.
 *   2. Create `DocxImportContext` with the editor's schema.
 *   3. Unzip OPC bytes, parse `word/document.xml`.
 *   4. Stage 1: walk into the normalized intermediate model.
 *   5. Run `onBeforeImport` hooks.
 *   6. Stage 2: dispatch via extension handlers → ProseMirror `Node`.
 *   7. Run `onImportComplete` hooks.
 *
 * Returns `{ doc, diagnostics }` — DOCX import is inherently lossy.
 * Fatal failures throw `DocxImportError` with the same diagnostics.
 *
 * The editor is required because nodes/marks are constructed against its
 * schema. Use `new ServerEditor()` for server-side imports — no view, no
 * layout, just the schema + extensions.
 */

import type { Node as PmNode } from "prosemirror-model";
import type {
  DocxImports,
  IBaseEditor,
  DocxDiagnostic,
} from "@scrivr/core";
import { readDocxPackage } from "./opc";
import { parseOoxml } from "./xml";
import { parseDocumentBody } from "./parser";
import { readNumberingMap } from "./numbering";
import { reconstructLists } from "./lists";
import {
  transformToProseMirror,
  type ResolvedImportHandlers,
} from "./transform";
import {
  createDocxImportContext,
  type DocxImportOptions,
} from "./context";
import { DocxImportError } from "./error";

export interface DocxImportResult {
  doc: PmNode;
  diagnostics: DocxDiagnostic[];
}

export interface DocxImportCallOptions extends DocxImportOptions {
  /** Override or supplement extension-contributed import handlers. */
  overrides?: DocxImports;
}

/**
 * Import a `.docx` file using the editor's schema + extension parsers.
 *
 * @example
 *   const editor = new ServerEditor();
 *   const { doc, diagnostics } = await importDocx(editor, bytes);
 *   editor.setContent(doc.toJSON());
 */
export async function importDocx(
  editor: IBaseEditor,
  bytes: Uint8Array,
  options: DocxImportCallOptions = {},
): Promise<DocxImportResult> {
  const ctx = createDocxImportContext({
    schema: editor.schema,
    ...options,
  });
  const handlers = collectHandlers(editor, options.overrides);
  const lifecycleHooks = collectLifecycleHooks(editor, options.overrides);

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

    for (const hook of lifecycleHooks.onBeforeImport) {
      await hook(ctx);
    }

    const numbering = readNumberingMap(pkg.readText("word/numbering.xml"));
    const rawModel = parseDocumentBody(root);
    const model = reconstructLists(rawModel, numbering);
    let doc = transformToProseMirror(model, ctx, handlers);

    for (const hook of lifecycleHooks.onImportComplete) {
      doc = await hook(doc, ctx);
    }

    return { doc, diagnostics: ctx.diagnostics.list() };
  } catch (err) {
    if (err instanceof DocxImportError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new DocxImportError(message, ctx.diagnostics.list());
  }
}

// ── Handler collection ──────────────────────────────────────────────────────

function collectHandlers(
  editor: IBaseEditor,
  overrides?: DocxImports,
): ResolvedImportHandlers {
  const blocks: ResolvedImportHandlers["blocks"] = {};
  const paragraphStyles: ResolvedImportHandlers["paragraphStyles"] = {};
  const marks: ResolvedImportHandlers["marks"] = {};

  for (const contrib of editor.getImportContributions()) {
    const docx = contrib.docx;
    if (!docx) continue;
    if (docx.blocks) Object.assign(blocks, docx.blocks);
    if (docx.paragraphStyles) Object.assign(paragraphStyles, docx.paragraphStyles);
    if (docx.marks) Object.assign(marks, docx.marks);
  }

  if (overrides) {
    if (overrides.blocks) Object.assign(blocks, overrides.blocks);
    if (overrides.paragraphStyles)
      Object.assign(paragraphStyles, overrides.paragraphStyles);
    if (overrides.marks) Object.assign(marks, overrides.marks);
  }

  return { blocks, paragraphStyles, marks };
}

interface LifecycleHooks {
  onBeforeImport: Array<NonNullable<DocxImports["onBeforeImport"]>>;
  onImportComplete: Array<NonNullable<DocxImports["onImportComplete"]>>;
}

function collectLifecycleHooks(
  editor: IBaseEditor,
  overrides?: DocxImports,
): LifecycleHooks {
  const hooks: LifecycleHooks = { onBeforeImport: [], onImportComplete: [] };
  for (const contrib of editor.getImportContributions()) {
    const docx = contrib.docx;
    if (!docx) continue;
    if (docx.onBeforeImport) hooks.onBeforeImport.push(docx.onBeforeImport);
    if (docx.onImportComplete) hooks.onImportComplete.push(docx.onImportComplete);
  }
  if (overrides) {
    if (overrides.onBeforeImport) hooks.onBeforeImport.push(overrides.onBeforeImport);
    if (overrides.onImportComplete) hooks.onImportComplete.push(overrides.onImportComplete);
  }
  return hooks;
}

export type { DocxImportOptions };
