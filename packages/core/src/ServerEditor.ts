import { EditorState } from "prosemirror-state";
import { StarterKit } from "./extensions/StarterKit";
import type { Extension } from "./extensions/Extension";
import { BaseEditor } from "./BaseEditor";

export interface ServerEditorOptions {
  /**
   * Extensions that define the schema and plugins (same as the client Editor).
   * Omit rendering-only extensions (e.g. CollaborationCursor) — they are ignored gracefully.
   * Defaults to [StarterKit].
   */
  extensions?: Extension[];
  /**
   * Optional initial document. Strings are parsed as markdown using the
   * merged token map from all extensions; objects are parsed as ProseMirror
   * JSON. If omitted, falls back to extensions' `addInitialDoc` (e.g.
   * `DefaultContent`).
   */
  content?: string | Record<string, unknown>;
}

/**
 * ServerEditor — a headless document engine for Node.js (or any non-browser
 * environment) that shares the same extension system and ProseMirror schema
 * as the client `Editor`.
 *
 * It has no canvas, DOM, layout, or cursor — only document state + commands.
 * View-only methods (`addOverlayRenderHandler`, `layout`, `getViewportRect`,
 * etc.) do not exist on this class. Calling them is a compile error.
 *
 * Typical server-side workflow:
 *   1. Load document JSON from your database.
 *   2. Create a ServerEditor with the document and relevant extensions.
 *   3. Apply transactions or run commands.
 *   4. Export the modified document back to JSON and persist it.
 *
 * @example
 *   import { ServerEditor } from "@scrivr/core";
 *   import { TrackChanges } from "@scrivr/plugins";
 *
 *   const editor = new ServerEditor({
 *     extensions: [StarterKit, TrackChanges.configure({ userID: "server", canAcceptReject: true })],
 *     content: docFromDb,
 *   });
 *
 *   editor.commands.insertAsSuggestion("Hello world", 1, 1, "AI Assistant");
 *   const updatedDoc = editor.toJSON();
 */
export class ServerEditor extends BaseEditor {
  constructor({ extensions = [StarterKit], content }: ServerEditorOptions = {}) {
    super({ extensions, ...(content ? { content } : {}) });
    // Fire onEditorReady after all state is initialised.
    // View-only extensions (CollaborationCursor etc.) that cast to IEditor
    // inside onEditorReady will get a runtime error if called — this is by design.
    this._fireEditorReady();
  }

  /**
   * Replace the document with a new one from ProseMirror JSON.
   * Re-initialises all plugin state (including TrackChanges).
   *
   * Note: this does NOT notify subscribers — it is a hard reset intended for
   * loading a fresh document. Call `subscribe` callbacks manually if needed.
   */
  setContent(json: Record<string, unknown>): void {
    const doc = this._manager.schema.nodeFromJSON(json);
    this._state = EditorState.create({
      schema: this._manager.schema,
      plugins: this._manager.buildPlugins(),
      doc,
    });
  }

  /**
   * Convenience alias — always `"ready"` on the server (no sync phase).
   */
  get loadingState(): "syncing" | "rendering" | "ready" {
    return "ready";
  }
}
