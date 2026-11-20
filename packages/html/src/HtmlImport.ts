/**
 * HtmlImport — extension that adds a "⬆ HTML" toolbar button and
 * `importHtmlFromFile` command to any Scrivr editor instance.
 *
 * Usage:
 *   import { HtmlImport } from "@scrivr/html";
 *
 *   new Editor({ extensions: [StarterKit, HtmlImport] });
 *
 * The command asks for an `.html` file, runs `importHtml`, and replaces the
 * editor's document, logging what could not be carried via `console.warn`.
 * On the server, or to show diagnostics, call `importHtml(editor, html)`.
 */

import { Extension, applyImportedDocument, pickFile } from "@scrivr/core";
import { importHtml } from "./browserImporter";

const HTML_TYPES = ".html,.htm,text/html";

export const HtmlImport = Extension.create({
  name: "htmlImport",

  addCommands() {
    return {
      importHtmlFromFile: () => (_state, dispatch) => {
        if (typeof document === "undefined") {
          if (dispatch) {
            console.warn(
              "[HtmlImport] editor.commands.importHtmlFromFile requires a browser " +
                "environment; use importHtml(editor, html) directly on the server.",
            );
          }
          return false;
        }
        if (dispatch) {
          const editor = this.editor();
          pickFile(HTML_TYPES)
            .then(async (file) => {
              if (!file) return;
              const { doc, diagnostics } = await importHtml(editor, await file.text());
              for (const d of diagnostics) console.warn(`[HtmlImport] ${d.level}: ${d.code} — ${d.message}`);
              applyImportedDocument(editor, doc);
            })
            .catch((err: unknown) => {
              console.error("[HtmlImport] import failed:", err);
            });
        }
        return true;
      },
    };
  },

  addToolbarItems() {
    return [
      {
        command: "importHtmlFromFile",
        label: "⬆ HTML",
        title: "Import from HTML",
        group: "export",
        isActive: () => false,
      },
    ];
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    htmlImport: {
      /** Open a file picker and import the chosen `.html` file into the editor. */
      importHtmlFromFile: () => ReturnType;
    };
  }
}
