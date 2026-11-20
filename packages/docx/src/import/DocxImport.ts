/**
 * DocxImport — extension that adds a "⬆ DOCX" toolbar button and
 * `importDocxFromFile` command to any Scrivr editor instance.
 *
 * Usage:
 *   import { DocxImport } from "@scrivr/docx";
 *
 *   new Editor({
 *     extensions: [
 *       StarterKit,
 *       DocxImport,
 *     ],
 *   });
 *
 * The toolbar command opens a native `<input type="file">` picker, reads
 * the chosen `.docx`, runs `importDocx`, and replaces the editor's doc
 * content. On the server, call `importDocx(editor, bytes)` directly — it
 * returns the parsed `Node` plus the diagnostics list.
 *
 * Diagnostics from the import run are logged via `console.warn` for
 * visibility during dogfooding. Apps that want to surface them in the UI
 * should call `importDocx` directly and read `result.diagnostics`.
 */

import { Extension, applyImportedDocument, pickFile } from "@scrivr/core";
import { importDocx as runImportDocx } from "./import";
import type { DocxImportOptions } from "./import";

interface DocxImportExtensionOptions {
  /** Default unsupported-node policy. Overridden per-call. Default: `"drop"`. */
  unsupported?: DocxImportOptions["unsupported"];
  /** Default fidelity. Overridden per-call. Default: `"compatible"`. */
  fidelity?: DocxImportOptions["fidelity"];
  /**
   * How to materialize image bytes. See `DocxImportOptions.media`.
   * Default: `"data-url"`.
   */
  media?: DocxImportOptions["media"];
}

/** Per-call options for `editor.commands.importDocxFromFile({...})`. */
interface ImportDocxCallOptions {
  unsupported?: DocxImportOptions["unsupported"];
  fidelity?: DocxImportOptions["fidelity"];
  media?: DocxImportOptions["media"];
}

const DOCX_TYPES =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const DocxImport = Extension.create<DocxImportExtensionOptions>({
  name: "docxImport",

  defaultOptions: {},

  addCommands() {
    return {
      importDocxFromFile:
        (callOptions?: ImportDocxCallOptions) =>
        (_state, dispatch) => {
          if (typeof document === "undefined") {
            if (dispatch) {
              console.warn(
                "[DocxImport] editor.commands.importDocxFromFile requires a " +
                  "browser environment; use importDocx(editor, bytes) directly " +
                  "on the server.",
              );
            }
            return false;
          }
          if (dispatch) {
            const editor = this.editor();
            const opts = resolveOptions(callOptions, this.options);
            pickFile(DOCX_TYPES)
              .then(async (file) => {
                if (!file) return;
                const bytes = new Uint8Array(await file.arrayBuffer());
                const { doc, diagnostics } = await runImportDocx(
                  editor,
                  bytes,
                  opts,
                );
                for (const d of diagnostics) {
                  const prefix = `[DocxImport] ${d.level}: ${d.code}`;
                  const suffix = d.nodeType ? ` (${d.nodeType})` : "";
                  console.warn(`${prefix}${suffix} — ${d.message}`);
                }
                applyImportedDocument(editor, doc);
              })
              .catch((err: unknown) => {
                console.error("[DocxImport] import failed:", err);
              });
          }
          return true;
        },
    };
  },

  addToolbarItems() {
    return [
      {
        command: "importDocxFromFile",
        label: "⬆ DOCX",
        title: "Import from DOCX",
        group: "export",
        isActive: () => false,
      },
    ];
  },
});

function resolveOptions(
  call: ImportDocxCallOptions | undefined,
  ext: DocxImportExtensionOptions,
): DocxImportOptions {
  const out: DocxImportOptions = {};
  const unsupported = call?.unsupported ?? ext.unsupported;
  if (unsupported !== undefined) out.unsupported = unsupported;
  const fidelity = call?.fidelity ?? ext.fidelity;
  if (fidelity !== undefined) out.fidelity = fidelity;
  const media = call?.media ?? ext.media;
  if (media !== undefined) out.media = media;
  return out;
}

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    docxImport: {
      /**
       * Open a file picker and import the chosen `.docx` into the editor.
       * Diagnostics from the run are logged via `console.warn`. For
       * programmatic access to diagnostics or server-side import, call
       * `importDocx(editor, bytes)` directly.
       */
      importDocxFromFile: (options?: ImportDocxCallOptions) => ReturnType;
    };
  }
}
