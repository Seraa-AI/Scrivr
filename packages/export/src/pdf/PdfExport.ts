/**
 * PdfExport — extension that adds an "Export PDF" toolbar button and
 * `exportPdf` command to any Inscribe editor instance.
 *
 * Lives in @inscribe/export (not core) because it depends on pdf-lib.
 *
 * Usage:
 *   import { PdfExport } from "@inscribe/export";
 *
 *   new Editor({
 *     extensions: [
 *       StarterKit,
 *       PdfExport.configure({ filename: "my-doc" }),
 *     ],
 *   });
 */
import { Extension } from "@inscribe/core";
import type { IEditor } from "@inscribe/core";
import { exportToPdf } from "./index";

interface PdfExportOptions {
  /** Downloaded file name (without .pdf). Default: "document" */
  filename?: string;
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
      exportPdf: () => (_state, dispatch) => {
        const inst = instanceState.get(this.options);
        if (!inst?.editor) return false;
        if (dispatch) {
          const { editor } = inst;
          const filename = this.options.filename ?? "document";
          exportToPdf(editor).then((bytes) => {
            const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href     = url;
            a.download = `${filename}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
          }).catch((err: unknown) => {
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

  onEditorReady(editor: IEditor) {
    const inst = instanceState.get(this.options);
    if (inst) inst.editor = editor;
    return () => {
      const i = instanceState.get(this.options);
      if (i) i.editor = null;
    };
  },
});
