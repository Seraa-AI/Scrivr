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
import type { IEditor, ResolvedTheme } from "@scrivr/core";
import { exportToPdf } from "./index";

interface PdfExportOptions {
  /** Downloaded file name (without .pdf). Default: "document" */
  filename?: string;
}

/** Per-call options accepted by `editor.commands.exportPdf({...})`. */
interface ExportPdfCallOptions {
  filename?: string;
  /**
   * Theme override. Shallow-merged over the print-ready `defaultPdfTheme`.
   * Literal CSS colors only — `var(...)` is not supported on this path.
   * Omit for a print-ready PDF regardless of canvas theme.
   */
  theme?: Partial<ResolvedTheme>;
}

/** Per-instance state — populated in onEditorReady, read in addCommands. */
interface InstanceState {
  editor: IEditor | null;
}
const instanceState = new WeakMap<object, InstanceState>();

export const PdfExport = Extension.create<PdfExportOptions>({
  name: "pdfExport",

  defaultOptions: {
    filename: "document",
  },

  // Seed the WeakMap early so addCommands can reference it via closure.
  addProseMirrorPlugins() {
    instanceState.set(this.options, { editor: null });
    return [];
  },

  addCommands() {
    return {
      exportPdf: (callOptions?: ExportPdfCallOptions) => (_state, dispatch) => {
        const inst = instanceState.get(this.options);
        if (!inst?.editor) return false;
        if (dispatch) {
          const { editor } = inst;
          const filename =
            callOptions?.filename ?? this.options.filename ?? "document";
          exportToPdf(
            editor,
            callOptions?.theme ? { theme: callOptions.theme } : undefined,
          )
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

  onViewReady(editor: IEditor) {
    // PDF export reads `editor.layout` + `editor.measurer` from the
    // browser editor's live layout pipeline, so the registration that
    // wires the `exportPdf` command to a concrete editor instance lives
    // here. A headless PDF export path would need its own document →
    // layout → PDF pipeline and is out of scope for this hook.
    const inst = instanceState.get(this.options);
    if (inst) inst.editor = editor;
    return () => {
      const i = instanceState.get(this.options);
      if (i) i.editor = null;
    };
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
