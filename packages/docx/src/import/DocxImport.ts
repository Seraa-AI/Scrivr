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

import { Extension } from "@scrivr/core";
import type { IBaseEditor } from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";
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

interface InstanceState {
  editor: IBaseEditor | null;
}
const instanceState = new WeakMap<object, InstanceState>();

export const DocxImport = Extension.create<DocxImportExtensionOptions>({
  name: "docxImport",

  defaultOptions: {},

  // Seed the WeakMap early so addCommands has it via closure.
  addProseMirrorPlugins() {
    instanceState.set(this.options, { editor: null });
    return [];
  },

  addCommands() {
    return {
      importDocxFromFile:
        (callOptions?: ImportDocxCallOptions) =>
        (_state, dispatch) => {
          const inst = instanceState.get(this.options);
          if (!inst?.editor) return false;
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
            const editor = inst.editor;
            const opts = resolveOptions(callOptions, this.options);
            openFilePicker()
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
                replaceDocument(editor, doc);
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

/**
 * Returns the picked file, or `undefined` if the user cancelled. Uses a
 * detached `<input>` so we don't leak DOM, and resolves on `change` (chosen)
 * or `cancel` (modern browsers — Chrome 113+, Firefox 109+, Safari 16.4+).
 *
 * Older browsers don't fire `cancel`, so the promise stays pending until
 * focus returns and we time out the listener (one tick after window focus).
 */
function openFilePicker(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    input.style.display = "none";

    let settled = false;
    const settle = (file: File | undefined) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      settle(file);
    });
    input.addEventListener("cancel", () => settle(undefined));

    // Focus-based fallback for browsers without the `cancel` event.
    window.addEventListener(
      "focus",
      () => {
        // The change event fires before focus returns when a file is
        // chosen, so a focus event without a settled promise means the
        // dialog was dismissed.
        setTimeout(() => settle(undefined), 300);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Replace the editor's entire doc content with `newDoc`. Mirrors the
 * pattern used by the collab YBinding and HeaderFooter surface — a single
 * `replaceWith` against the root range.
 */
function replaceDocument(editor: IBaseEditor, newDoc: PmNode): void {
  const state = editor.getState();
  const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);
  editor.applyTransaction(tr);
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
