/**
 * SemanticExport — extension that adds a "⬇ Chunks" toolbar button and an
 * `exportSemantic` command to any Scrivr editor instance, mirroring
 * `DocxExport` / `PdfExport`.
 *
 * Usage:
 *   import { SemanticExport } from "@scrivr/export-semantic";
 *
 *   new Editor({
 *     extensions: [
 *       StarterKit,
 *       SemanticExport.configure({ filename: "my-doc-chunks" }),
 *     ],
 *   });
 *
 *   editor.commands.exportSemantic();                       // downloads .json
 *   editor.commands.exportSemantic({ onExport: embedAll }); // hand off the data
 *
 * Semantic units are data, not a byte blob — so unlike docx/pdf, the command
 * takes an optional `onExport(units)` callback (the headless-friendly path,
 * since ProseMirror commands can't return a value). With no callback it triggers
 * a browser JSON download. On the server without a callback, call
 * `toSemanticUnits(editor)` directly instead.
 */
import { Extension } from "@scrivr/core";
import type { SemanticUnit } from "@scrivr/core";
import { toSemanticUnits } from "./toSemanticUnits";

interface SemanticExportExtensionOptions {
  /** Downloaded file name (without `.json`). Default: `"semantic-units"`. */
  filename?: string;
  /**
   * Max chars for the "short lede" a heading may absorb into one unit.
   * Overridden per-call. Default: 200.
   */
  shortBlockMaxChars?: number;
}

/** Per-call options for `editor.commands.exportSemantic({...})`. */
interface ExportSemanticCallOptions {
  filename?: string;
  shortBlockMaxChars?: number;
  /**
   * Receive the emitted units instead of downloading a file. This is the
   * headless-usable path (works on `ServerEditor`, no DOM required).
   */
  onExport?: (units: SemanticUnit[]) => void;
}

export const SemanticExport = Extension.create<SemanticExportExtensionOptions>({
  name: "semanticExport",

  defaultOptions: {
    filename: "semantic-units",
  },

  addCommands() {
    return {
      exportSemantic:
        (callOptions?: ExportSemanticCallOptions) =>
        (_state, dispatch) => {
          const onExport = callOptions?.onExport;
          if (!onExport && typeof document === "undefined") {
            // Download path is browser-only. Server callers should pass
            // `onExport` or use `toSemanticUnits(editor)` directly.
            if (dispatch) {
              console.warn(
                "[SemanticExport] editor.commands.exportSemantic requires a browser " +
                  "environment; pass `onExport` or use toSemanticUnits(editor) on the server.",
              );
            }
            return false;
          }

          if (dispatch) {
            const shortBlockMaxChars =
              callOptions?.shortBlockMaxChars ?? this.options.shortBlockMaxChars;
            const units = toSemanticUnits(
              this.editor(),
              shortBlockMaxChars !== undefined ? { shortBlockMaxChars } : {},
            );
            if (onExport) {
              onExport(units);
            } else {
              const filename =
                callOptions?.filename ?? this.options.filename ?? "semantic-units";
              triggerDownload(units, `${filename}.json`);
            }
          }
          return true;
        },
    };
  },

  addToolbarItems() {
    return [
      {
        command: "exportSemantic",
        label: "⬇ Chunks",
        title: "Export semantic units (JSON)",
        group: "export",
        isActive: () => false,
      },
    ];
  },
});

function triggerDownload(units: SemanticUnit[], filename: string): void {
  const blob = new Blob([JSON.stringify(units, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    semanticExport: {
      /**
       * Emit the document's `SemanticUnit[]`. With `onExport` the units are
       * handed to the callback (works headlessly); otherwise they are downloaded
       * as a `.json` file in the browser. For direct programmatic access use
       * `toSemanticUnits(editor)`.
       */
      exportSemantic: (options?: ExportSemanticCallOptions) => ReturnType;
    };
  }
}
