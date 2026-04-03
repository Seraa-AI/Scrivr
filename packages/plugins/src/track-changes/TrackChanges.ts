import { Extension, renderTrackedInsert, renderTrackedDelete, renderTrackedConflict } from "@scrivr/core";
import type { GlyphEntry, IEditor, LineEntry, OverlayRenderHandler } from "@scrivr/core";
import type { EditorState, Transaction } from "prosemirror-state";

import { setAction, skipTracking, TrackChangesAction } from "./actions";
import { trackChangesPlugin, trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { addTrackIdIfDoesntExist, createNewDeleteAttrs, createNewInsertAttrs, createNewPendingAttrs } from "./helpers";
import { CHANGE_OPERATION, CHANGE_STATUS, TrackChangesOptions, TrackChangesStatus } from "./types";

/**
 * Insert palette — green family. Semantic: "adding content".
 * Different shades let you distinguish authors at a glance while keeping
 * the green = insert convention consistent.
 */
const INSERT_COLORS = ["#16a34a", "#15803d", "#059669", "#10b981", "#0d9488", "#0891b2"];

/**
 * Delete palette — red/rose family. Semantic: "removing content".
 */
const DELETE_COLORS = ["#dc2626", "#b91c1c", "#e11d48", "#be185d", "#c2410c", "#9a3412"];

function authorIndex(authorID: string): number {
  let hash = 0;
  for (let i = 0; i < authorID.length; i++) {
    hash = (hash * 31 + authorID.charCodeAt(i)) >>> 0;
  }
  return hash % INSERT_COLORS.length;
}

function insertColor(authorID: string): string {
  return INSERT_COLORS[authorIndex(authorID)]!;
}

function deleteColor(authorID: string): string {
  return DELETE_COLORS[authorIndex(authorID)]!;
}

/**
 * TrackChanges — opt-in track-changes plugin for @scrivr/plugins.
 *
 * Adds `tracked_insert` and `tracked_delete` marks to the schema (opt-in),
 * intercepts all transactions via appendTransaction, and exposes commands
 * for toggling tracking status and accepting/rejecting changes.
 *
 * Commands:
 *   setTrackingStatus(status?)  — toggle or set tracking status
 *   setChangeStatuses(status, ids) — accept or reject changes (gated by canAcceptReject)
 *   setTrackChangesUserID(userID) — update the current user ID
 *   refreshChanges()             — force-rebuild the ChangeSet
 */
export const TrackChanges = Extension.create<TrackChangesOptions>({
  name: "trackChanges",

  defaultOptions: {
    initialStatus: TrackChangesStatus.disabled,
    userID: "anonymous:Anonymous",
    canAcceptReject: false,
  },

  addMarks() {
    return {
      tracked_insert: {
        attrs: {
          dataTracked: { default: null },
        },
        inclusive: false,
        // Allow multiple tracked_insert marks on the same text node segment
        // so that overlapping suggestions from different authors can coexist.
        // Each mark instance still carries a single author in dataTracked.
        excludes: "",
        parseDOM: [{ tag: "ins[data-tracked]" }],
        toDOM() {
          return ["ins", { "data-tracked": "insert" }, 0];
        },
      },
      tracked_delete: {
        attrs: {
          dataTracked: { default: null },
        },
        inclusive: false,
        // Same as tracked_insert — allow stacking from multiple authors.
        excludes: "",
        parseDOM: [{ tag: "del[data-tracked]" }],
        toDOM() {
          return ["del", { "data-tracked": "delete" }, 0];
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const { userID } = this.options;
    const opts: TrackChangesOptions = { userID };
    if (this.options.initialStatus !== undefined) opts.initialStatus = this.options.initialStatus;
    if (this.options.canAcceptReject !== undefined) opts.canAcceptReject = this.options.canAcceptReject;
    if (this.options.skipTrsWithMetas !== undefined) opts.skipTrsWithMetas = this.options.skipTrsWithMetas;
    return [
      trackChangesPlugin(opts),
    ];
  },

  addCommands() {
    return {
      setTrackingStatus:
        (...args: unknown[]) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          const status = args[0] as TrackChangesStatus | undefined;
          const currentStatus = trackChangesPluginKey.getState(state)?.status;
          if (!currentStatus) return false;

          let newStatus = status;
          if (newStatus === undefined) {
            newStatus =
              currentStatus === TrackChangesStatus.enabled
                ? TrackChangesStatus.disabled
                : TrackChangesStatus.enabled;
          }

          dispatch?.(
            setAction(state.tr, TrackChangesAction.setPluginStatus, newStatus),
          );

          return true;
        },

      setChangeStatuses:
        (...args: unknown[]) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          const status = args[0] as CHANGE_STATUS;
          const ids = args[1] as string[];
          const pluginState = trackChangesPluginKey.getState(state);
          if (!pluginState?.canAcceptReject) return false;

          dispatch?.(
            setAction(state.tr, TrackChangesAction.setChangeStatuses, {
              status,
              ids,
            }),
          );
          return true;
        },

      setTrackChangesUserID:
        (...args: unknown[]) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          const userID = args[0] as string;
          dispatch?.(setAction(state.tr, TrackChangesAction.setUserID, userID));
          return true;
        },

      refreshChanges:
        (..._args: unknown[]) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          dispatch?.(
            setAction(state.tr, TrackChangesAction.refreshChanges, true),
          );
          return true;
        },

      /**
       * Insert text as a pending suggestion, regardless of the current tracking
       * status. The inserted text gets a `tracked_insert` mark attributed to
       * `authorID`, and any replaced selection gets a `tracked_delete` mark.
       *
       * This is the correct way for AI assistants to propose edits — they always
       * show up as suggestions the user can accept or reject, never as direct edits.
       *
       * args: [text: string, from: number, to: number, authorID: string]
       */
      insertAsSuggestion:
        (...args: unknown[]) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          const [text, from, to, authorID] = args as [string, number, number, string];
          const schema = state.schema;
          const insertMarkType = schema.marks.tracked_insert;
          const deleteMarkType = schema.marks.tracked_delete;
          if (!insertMarkType) return false; // TrackChanges not in schema

          const now = Date.now();
          const baseAttrs = createNewPendingAttrs(now, authorID);

          const insertMark = insertMarkType.create({
            dataTracked: addTrackIdIfDoesntExist(createNewInsertAttrs(baseAttrs)),
          });

          // Sanitise the text — ProseMirror text nodes cannot contain raw newlines.
          const safeText = text.replace(/\n/g, " ");
          const textNode = schema.text(safeText, [insertMark]);

          const tr = state.tr;

          // If replacing a selection, mark the old text as deleted (it stays in the
          // document so the user can see what would be removed).
          if (from < to && deleteMarkType) {
            const deleteMark = deleteMarkType.create({
              dataTracked: addTrackIdIfDoesntExist(createNewDeleteAttrs(baseAttrs)),
            });
            tr.addMark(from, to, deleteMark);
          }

          // Insert the suggestion at `from` (before any "deleted" text).
          tr.insert(from, textNode);

          // Prevent appendTransaction from trying to re-track this transaction.
          skipTracking(tr);
          // Ensure the changeSet is rebuilt so the new marks are visible.
          setAction(tr, TrackChangesAction.refreshChanges, true);

          dispatch?.(tr);
          return true;
        },
    };
  },

  onEditorReady(editor: IEditor) {
    const handler: OverlayRenderHandler = (ctx, pageNumber, _pageConfig, charMap) => {
      const state = editor.getState();
      const pluginState = trackChangesPluginKey.getState(state);
      if (!pluginState) return;

      const { changeSet } = pluginState;

      // Deduplicate glyph rendering: multiple changes can cover the same glyphs
      // (e.g. two authors' inserts at the same position). Rendering each change
      // independently stacks fills at the same pixels, darkening them. Instead,
      // collect the first-author color per glyph position and render each pixel once.
      const insertGlyphs = new Map<number, { glyph: GlyphEntry; color: string }>();
      const deleteGlyphs = new Map<number, { glyph: GlyphEntry; color: string }>();
      const insertLines = new Map<number, { line: LineEntry; color: string }>();
      const deleteLines = new Map<number, { line: LineEntry; color: string }>();
      // Conflict glyphs/lines are also deduplicated by position — without this,
      // N overlapping conflict changes push the same glyphs N times, causing
      // renderTrackedConflict to layer N semi-transparent amber fills at the
      // same pixels and produce a solid opaque orange block.
      const conflictGlyphsMap = new Map<number, GlyphEntry>();
      const conflictLinesMap = new Map<number, LineEntry>();

      for (const change of changeSet.changes) {
        const { operation, authorID } = change.dataTracked;
        const author = authorID ?? "unknown";
        const isConflict = !!(change.dataTracked as { isConflict?: boolean }).isConflict;

        const glyphs = charMap.glyphsInRange(change.from, change.to)
          .filter(g => g.page === pageNumber);
        const lines = charMap.linesInRange(change.from, change.to)
          .filter(l => l.page === pageNumber);

        if (operation === CHANGE_OPERATION.insert || operation === CHANGE_OPERATION.move) {
          const color = insertColor(author);
          for (const g of glyphs) {
            if (!insertGlyphs.has(g.docPos)) insertGlyphs.set(g.docPos, { glyph: g, color });
          }
          for (const l of lines) {
            if (!insertLines.has(l.lineIndex)) insertLines.set(l.lineIndex, { line: l, color });
          }
        } else if (operation === CHANGE_OPERATION.delete) {
          const color = deleteColor(author);
          for (const g of glyphs) {
            if (!deleteGlyphs.has(g.docPos)) deleteGlyphs.set(g.docPos, { glyph: g, color });
          }
          for (const l of lines) {
            if (!deleteLines.has(l.lineIndex)) deleteLines.set(l.lineIndex, { line: l, color });
          }
        }

        if (isConflict) {
          for (const g of glyphs) {
            if (!conflictGlyphsMap.has(g.docPos)) conflictGlyphsMap.set(g.docPos, g);
          }
          for (const l of lines) {
            if (!conflictLinesMap.has(l.lineIndex)) conflictLinesMap.set(l.lineIndex, l);
          }
        }
      }

      // Render inserts — each glyph rendered exactly once
      if (insertGlyphs.size > 0 || insertLines.size > 0) {
        // Group by color so we minimise ctx state changes
        const byColor = new Map<string, { glyphs: GlyphEntry[]; lines: LineEntry[] }>();
        for (const { glyph, color } of insertGlyphs.values()) {
          if (!byColor.has(color)) byColor.set(color, { glyphs: [], lines: [] });
          byColor.get(color)!.glyphs.push(glyph);
        }
        for (const { line, color } of insertLines.values()) {
          if (!byColor.has(color)) byColor.set(color, { glyphs: [], lines: [] });
          byColor.get(color)!.lines.push(line);
        }
        for (const [color, { glyphs, lines }] of byColor) {
          renderTrackedInsert(ctx, glyphs, lines, color);
        }
      }

      // Render deletes — each glyph rendered exactly once
      if (deleteGlyphs.size > 0 || deleteLines.size > 0) {
        const byColor = new Map<string, { glyphs: GlyphEntry[]; lines: LineEntry[] }>();
        for (const { glyph, color } of deleteGlyphs.values()) {
          if (!byColor.has(color)) byColor.set(color, { glyphs: [], lines: [] });
          byColor.get(color)!.glyphs.push(glyph);
        }
        for (const { line, color } of deleteLines.values()) {
          if (!byColor.has(color)) byColor.set(color, { glyphs: [], lines: [] });
          byColor.get(color)!.lines.push(line);
        }
        for (const [color, { glyphs, lines }] of byColor) {
          renderTrackedDelete(ctx, glyphs, lines, color);
        }
      }

      // Conflict overlay — rendered on top of insert/delete colours
      const conflictGlyphs = [...conflictGlyphsMap.values()];
      const conflictLines = [...conflictLinesMap.values()];
      if (conflictGlyphs.length > 0 || conflictLines.length > 0) {
        renderTrackedConflict(ctx, conflictGlyphs, conflictLines);
      }
    };

    return editor.addOverlayRenderHandler(handler);
  },
});
