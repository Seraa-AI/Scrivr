/**
 * PdfExport — extension that adds an "Export PDF" toolbar button and
 * `exportPdf` command to a browser editor. Export renders from the live layout
 * pipeline, so a headless host calls `exportToPdf(editor, opts)` directly.
 *
 * Lives in @scrivr/export (not core) because it depends on pdf-lib.
 *
 * Usage:
 *   import { PdfExport } from "@scrivr/export";
 *
 *   new Editor({
 *     extensions: [
 *       StarterKit,
 *       PdfExport.configure({ filename: "my-doc" }),
 *     ],
 *   });
 */
import { Extension } from "@scrivr/core";
import type { IBaseEditor, IEditor } from "@scrivr/core";
import { exportToPdf, type PdfExportOptions } from "./index";

/** Options the extension itself is configured with. */
interface PdfExportExtensionOptions {
  /** Downloaded file name (without .pdf). Default: "document" */
  filename?: string;
}

/**
 * Per-call options accepted by `editor.commands.exportPdf({...})`.
 *
 * Everything the export itself accepts, plus the file name the command needs
 * and the export does not. Listing a subset here is how `onFontShortfall`
 * became unreachable from the command most applications actually call.
 */
interface ExportPdfCallOptions extends PdfExportOptions {
  filename?: string;
}

/** Probes what the export calls: a headless editor has no layout pipeline. */
function isViewEditor(editor: IBaseEditor): editor is IEditor {
  return "layout" in editor && "ensureFullLayout" in editor;
}

export const PdfExport = Extension.create<PdfExportExtensionOptions>({
  name: "pdfExport",

  defaultOptions: {
    filename: "document",
  },

  addCommands() {
    return {
      exportPdf: (callOptions?: ExportPdfCallOptions) => (_state, dispatch) => {
        const editor = this.editor();
        if (!isViewEditor(editor)) {
          if (dispatch) {
            console.warn(
              "[PdfExport] exportPdf needs an editor with a layout pipeline. " +
                "Server callers should use the bare `exportToPdf(editor, opts)` function.",
            );
          }
          return false;
        }
        if (dispatch) {
          const filename =
            callOptions?.filename ?? this.options.filename ?? "document";
          const { filename: _filename, ...exportOptions } = callOptions ?? {};
          // The name the file is saved under is the name the document has.
          // A caller that knows better passes its own title.
          exportToPdf(editor, {
            ...exportOptions,
            metadata: { title: filename, ...exportOptions.metadata },
          })
            .then((bytes) => {
              const blob = new Blob([bytes.buffer as ArrayBuffer], {
                type: "application/pdf",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${filename}.pdf`;
              a.click();
              URL.revokeObjectURL(url);
            })
            .catch((err: unknown) => {
              console.error("[PdfExport] export failed:", err);
            });
        }
        return true;
      },
    };
  },

  addToolbarItems() {
    return [
      {
        command: "exportPdf",
        label: "⬇ PDF",
        title: "Export as PDF",
        group: "export",
        isActive: () => false, // never "active" — it's an action, not a toggle
      },
    ];
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    pdfExport: {
      /**
       * Export the current document as a PDF and trigger a browser download.
       * Accepts an optional `theme` (literal CSS colors, shallow-merged over
       * the print-ready `defaultPdfTheme`) and an optional per-call `filename`.
       */
      exportPdf: (options?: ExportPdfCallOptions) => ReturnType;
    };
  }
}
