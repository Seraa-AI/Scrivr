/**
 * PdfExport — extension that adds an "Export PDF" toolbar button and
 * `exportPdf` command to any Scrivr editor instance.
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

/**
 * PDF export reads `layout` and `measurer`, which only a browser editor has —
 * a headless one has no layout pipeline to render from.
 */
function isViewEditor(editor: IBaseEditor): editor is IEditor {
  return "layout" in editor && "measurer" in editor;
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
        if (!isViewEditor(editor)) return false;
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
