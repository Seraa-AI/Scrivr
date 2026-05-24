/**
 * DocxExport — extension that adds a "⬇ DOCX" toolbar button and
 * `exportDocx` command to any Scrivr editor instance.
 *
 * Usage:
 *   import { DocxExport } from "@scrivr/docx";
 *
 *   new Editor({
 *     extensions: [
 *       StarterKit,
 *       DocxExport.configure({ filename: "my-doc" }),
 *     ],
 *   });
 *
 * The toolbar command triggers a browser download. On the server, call
 * `exportDocx(editor, opts)` directly instead — it returns the bytes plus
 * the diagnostics list so the caller can decide what to do with them.
 *
 * Diagnostics from the export run are logged via `console.warn` for visibility
 * during dogfooding. If your app wants to surface them in the UI, call
 * `exportDocx(editor, opts)` directly and read `result.diagnostics`.
 */

import { Extension } from "@scrivr/core";
import type { IBaseEditor } from "@scrivr/core";
import { exportDocx as runExportDocx } from "./export";
import type { DocxExportOptions } from "./export";

interface DocxExportExtensionOptions {
  /** Downloaded file name (without `.docx`). Default: `"document"`. */
  filename?: string;
  /** Default unsupported-node policy. Overridden per-call. Default: `"drop"`. */
  unsupported?: DocxExportOptions["unsupported"];
  /** Default fidelity. Overridden per-call. Default: `"compatible"`. */
  fidelity?: DocxExportOptions["fidelity"];
}

/** Per-call options for `editor.commands.exportDocx({...})`. */
interface ExportDocxCallOptions {
  filename?: string;
  unsupported?: DocxExportOptions["unsupported"];
  fidelity?: DocxExportOptions["fidelity"];
}

interface InstanceState {
  editor: IBaseEditor | null;
}
const instanceState = new WeakMap<object, InstanceState>();

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const DocxExport = Extension.create<DocxExportExtensionOptions>({
  name: "docxExport",

  defaultOptions: {
    filename: "document",
  },

  // Seed the WeakMap early so addCommands has it via closure.
  addProseMirrorPlugins() {
    instanceState.set(this.options, { editor: null });
    return [];
  },

  addCommands() {
    return {
      exportDocx:
        (callOptions?: ExportDocxCallOptions) =>
        (_state, dispatch) => {
          const inst = instanceState.get(this.options);
          if (!inst?.editor) return false;
          if (typeof document === "undefined") {
            // Toolbar command is browser-only. Server callers should use the
            // bare `exportDocx(editor, opts)` function.
            if (dispatch) {
              console.warn(
                "[DocxExport] editor.commands.exportDocx requires a browser environment; " +
                  "use exportDocx(editor, opts) directly on the server.",
              );
            }
            return false;
          }
          if (dispatch) {
            const editor = inst.editor;
            const filename =
              callOptions?.filename ?? this.options.filename ?? "document";
            const opts = resolveOptions(callOptions, this.options);

            runExportDocx(editor, opts)
              .then(({ bytes, diagnostics }) => {
                for (const d of diagnostics) {
                  const prefix = `[DocxExport] ${d.level}: ${d.code}`;
                  const suffix = d.nodeType ? ` (${d.nodeType})` : "";
                  console.warn(`${prefix}${suffix} — ${d.message}`);
                }
                triggerDownload(bytes, `${filename}.docx`);
              })
              .catch((err: unknown) => {
                console.error("[DocxExport] export failed:", err);
              });
          }
          return true;
        },
    };
  },

  addToolbarItems() {
    return [
      {
        command: "exportDocx",
        label: "⬇ DOCX",
        title: "Export as DOCX",
        group: "export",
        isActive: () => false,
      },
    ];
  },

  // DOCX export is layout-free — onEditorReady fires in both browser Editor
  // and ServerEditor. Registering here keeps the command available headlessly
  // even though the toolbar command path itself requires a DOM.
  onEditorReady(editor: IBaseEditor) {
    const inst = instanceState.get(this.options);
    if (inst) inst.editor = editor;
    return () => {
      const i = instanceState.get(this.options);
      if (i) i.editor = null;
    };
  },
});

function resolveOptions(
  call: ExportDocxCallOptions | undefined,
  ext: DocxExportExtensionOptions,
): DocxExportOptions {
  const out: DocxExportOptions = {};
  const unsupported = call?.unsupported ?? ext.unsupported;
  if (unsupported !== undefined) out.unsupported = unsupported;
  const fidelity = call?.fidelity ?? ext.fidelity;
  if (fidelity !== undefined) out.fidelity = fidelity;
  return out;
}

function triggerDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: DOCX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    docxExport: {
      /**
       * Export the current document as a `.docx` and trigger a browser download.
       * Diagnostics from the run are logged via `console.warn`. For programmatic
       * access to diagnostics or server-side export, call `exportDocx(editor)`
       * directly.
       */
      exportDocx: (options?: ExportDocxCallOptions) => ReturnType;
    };
  }
}
