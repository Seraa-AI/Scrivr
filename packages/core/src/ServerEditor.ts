import { EditorState } from "prosemirror-state";
import { StarterKit } from "./extensions/StarterKit";
import type { Extension } from "./extensions/Extension";
import { BaseEditor } from "./BaseEditor";
import {
  defaultEditorTheme,
  mergeEditorTheme,
  themeContainsCssVars,
  type EditorTheme,
  type ResolvedTheme,
} from "./model/theme";
import { normalizeDocument } from "./model/normalizeDocument";

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
  /**
   * Theme accepted for type parity with the browser `Editor`. ServerEditor
   * never paints, so theme is stored but unused. Values containing `var(...)`
   * cannot be resolved without a DOM — the constructor warns on those once.
   *
   * For PDF export from the server, pass literal colors via
   * `editor.commands.exportPdf({ theme: { ... } })` (typed `Partial<ResolvedTheme>`).
   */
  theme?: EditorTheme;
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
  /** The user-provided input theme (literal-only on the server path). */
  private readonly theme: EditorTheme;
  /**
   * Resolved theme — defaults merged with the user's literal overrides. Any
   * `var(...)` entries are dropped (warned at construct) since there is no
   * DOM resolver server-side.
   */
  private readonly resolvedTheme: ResolvedTheme;

  constructor({ extensions = [StarterKit], content, theme }: ServerEditorOptions = {}) {
    super({ extensions, ...(content ? { content } : {}) });
    if (theme && themeContainsCssVars(theme)) {
      console.warn(
        "[ServerEditor] theme contains var(--...) values that cannot be resolved without a DOM. " +
          "Use literal colors for server-side themes, or pass theme via " +
          "`editor.commands.exportPdf({ theme: { ... } })` for PDF export.",
      );
    }
    this.theme = mergeEditorTheme({}, theme ?? {});
    // Strip var() entries — they can't be resolved without a DOM probe.
    const literalOverrides: Partial<ResolvedTheme> = {};
    for (const key of Object.keys(this.theme) as Array<keyof EditorTheme>) {
      const value = this.theme[key];
      if (typeof value === "string" && !value.includes("var(")) {
        literalOverrides[key] = value;
      }
    }
    this.resolvedTheme = Object.freeze({ ...defaultEditorTheme, ...literalOverrides });
    // Engine-phase only — view-only extensions declare `onViewReady`, which
    // the engine only fires in browser `Editor`. ServerEditor silently skips
    // that phase, so view APIs (overlays, layout, redraw, selection,
    // surfaces) never get touched headlessly.
    this.fireEditorReady();
  }

  /** The current input theme (may contain literal colors only on the server). */
  getTheme(): EditorTheme {
    return this.theme;
  }

  /**
   * The resolved theme — defaults merged with the user's literal overrides.
   * Pass to `exportPdf({ theme: editor.getResolvedTheme() })` to opt into a
   * themed PDF without re-specifying colors.
   */
  getResolvedTheme(): ResolvedTheme {
    return this.resolvedTheme;
  }

  /**
   * Replace the document with a new one from ProseMirror JSON.
   * Re-initialises all plugin state (including TrackChanges).
   *
   * Note: this does NOT notify subscribers — it is a hard reset intended for
   * loading a fresh document. Call `subscribe` callbacks manually if needed.
   */
  setContent(json: Record<string, unknown>): void {
    // Ingestion-time normalization — URL allow-list, table repair,
    // block-ID assignment, fingerprint, warnings. Same pipeline as the
    // base constructor; `lastNormalizeResult` (inherited from BaseEditor)
    // is refreshed so consumers can inspect what was repaired.
    const result = normalizeDocument(json, { schema: this.manager.schema });
    this._lastNormalizeResult = result;
    this.editorState = EditorState.create({
      schema: this.manager.schema,
      plugins: this.manager.buildPlugins(),
      doc: result.doc,
    });
  }

  /**
   * Convenience alias — always `"ready"` on the server (no sync phase).
   */
  get loadingState(): "syncing" | "rendering" | "ready" {
    return "ready";
  }
}
