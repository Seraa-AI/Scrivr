import {
  Extension,
  renderTrackedInsert,
  renderTrackedDelete,
  renderTrackedConflict,
  renderTrackedAttrChange,
  renderTrackedObject,
  renderTrackedFormatting,
  renderTrackedMove,
  renderTrackedRow,
} from "@scrivr/core";
import type {
  CharacterMap,
  GlyphEntry,
  IEditor,
  LineEntry,
  OverlayRenderHandler,
} from "@scrivr/core";
import type { EditorState, Node, Transaction } from "@scrivr/core/pm";

import { setAction, skipTracking, TrackChangesAction } from "./actions";
import { trackChangesPlugin, trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { lastCutPlugin } from "./lib/cutAndPaste";
import { suggestedContent } from "./lib/suggestedContent";
import { addTrackIdIfDoesntExist, createNewDeleteAttrs, createNewInsertAttrs, createNewPendingAttrs, proposedForDeletion } from "./helpers";
import { CHANGE_OPERATION, CHANGE_STATUS, TrackChangesOptions, TrackChangesStatus, type TrackedChange } from "./types";
import { planReviewIn } from "./reviewChanges";
import { changeActs } from "./reviewPlan";
import type { ChangeSet } from "./ChangeSet";
import { cloneTrackedChanges } from "./cloneTrackedChanges";
import { dropDeleted, isMarkRemoved, keepInserted, nodeChanges } from "./semanticChanges";

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    trackChanges: {
      /**
       * Toggle or explicitly set the track-changes status.
       * Pass no argument to toggle between enabled/disabled.
       */
      setTrackingStatus: (status?: TrackChangesStatus) => ReturnType;
      /**
       * Accept or reject a set of tracked changes by their IDs. Returns false,
       * deciding nothing, when the plan is blocked — dependent work included. A
       * host that needs to know why calls `reviewChanges`.
       */
      setChangeStatuses: (status: "accepted" | "rejected", ids: string[]) => ReturnType;
      /** Update the userID attributed to future tracked changes. */
      setTrackChangesUserID: (userID: string) => ReturnType;
      /** Force a refresh of the tracked-changes decoration state. */
      refreshChanges: () => ReturnType;
      /**
       * Insert text as a pending tracked-insert suggestion.
       * Any existing text in [from, to] is wrapped in a tracked-delete mark.
       */
      insertAsSuggestion: (text: string, from: number, to: number, authorID: string) => ReturnType;
    };
  }

  interface MarkAttributes {
    trackedInsert: {
      dataTracked: Record<string, unknown> | null;
    };
    trackedDelete: {
      dataTracked: Record<string, unknown> | null;
    };
  }
}


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

/**
 * Attribute-change color — amber. Distinct from insert/delete so reviewers
 * immediately recognise "formatting was changed here".
 */
const ATTR_CHANGE_COLOR = "#d97706";
/** Moves are one colour whoever made them, as Word marks moved text. */
const MOVE_COLOR = "#15803d";

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where a leaf node — an image, a rule, a page break — is drawn on this page: an
 * anchored image's own box, an inline object's painted box, or a block leaf's line.
 */
function objectBox(
  pos: number,
  node: Node,
  placements: ReadonlyArray<Box & { docPos: number }>,
  charMap: CharacterMap,
  pageNumber: number,
  lines: LineEntry[],
): Box | null {
  const placed = placements.find(placement => placement.docPos === pos);
  if (placed) return { x: placed.x, y: placed.y, width: placed.width, height: placed.height };
  const painted = charMap.getObjectRect(pos);
  if (node.isInline && painted?.page === pageNumber) return painted;
  const line = lines[0];
  if (node.isBlock && line) return { x: line.x, y: line.y, width: line.contentWidth, height: line.height };
  return null;
}

/** A table row someone added or removed, marked as a row rather than as loose words in its cells. */
const isRowAddedOrRemoved = (change: TrackedChange) =>
  change.type === "node-change" && change.node.type.name === "tableRow" &&
  (change.dataTracked.operation === CHANGE_OPERATION.insert || change.dataTracked.operation === CHANGE_OPERATION.delete);

const rowRecordsCache = new WeakMap<ChangeSet, ReadonlySet<string>>();

/**
 * A row added or removed is shown by the row: the cells, paragraphs and words
 * that are part of adding or removing it carry no marks of their own. Cached
 * per change set, which every page of a paint shares.
 */

function recordsInsideRowChanges(changeSet: ChangeSet): ReadonlySet<string> {
  const cached = rowRecordsCache.get(changeSet);
  if (cached) return cached;
  const ids = new Set(
    changeActs(changeSet.pending)
      .filter(({ primary }) => isRowAddedOrRemoved(primary))
      .flatMap(({ primary, records }) => records.filter((record) => record !== primary).map((record) => record.id)),
  );
  rowRecordsCache.set(changeSet, ids);
  return ids;
}

/**
 * How a change to an object is coloured, by what it did. A map, as every
 * operation table here is: a synced record may name `__proto__` or `toString`.
 */
const OBJECT_COLOR = new Map<string, (author: string) => string>([
  [CHANGE_OPERATION.insert, author => insertColor(author)],
  [CHANGE_OPERATION.move, author => insertColor(author)],
  [CHANGE_OPERATION.delete, author => deleteColor(author)],
  [CHANGE_OPERATION.set_node_attributes, () => ATTR_CHANGE_COLOR],
]);

/** The colour an object's change is framed in, or none when the operation frames nothing. */
export const objectColor = (operation: string, author: string): string | undefined =>
  OBJECT_COLOR.get(operation)?.(author);

/**
 * Changes to a block rather than its text — its attributes, the break that ends
 * it, its place in a list — have no glyphs of their own to colour, so they are
 * marked with a bar beside the block.
 */
const BLOCK_CHANGES: ReadonlySet<CHANGE_OPERATION> = new Set([
  CHANGE_OPERATION.set_node_attributes,
  CHANGE_OPERATION.node_split,
  CHANGE_OPERATION.node_join,
  CHANGE_OPERATION.list_change,
  CHANGE_OPERATION.wrap_with_node,
  CHANGE_OPERATION.structure,
]);

/**
 * Stable first-seen assignment: each new authorID gets the next available
 * palette slot. Authors 1–6 each get a distinct shade; beyond 6 the slot
 * wraps. This avoids hash collisions that could give two different authors
 * the same color within the palette size.
 */
const _authorIndexMap = new Map<string, number>();
let _nextAuthorSlot = 0;

function authorIndex(authorID: string): number {
  if (!_authorIndexMap.has(authorID)) {
    _authorIndexMap.set(authorID, _nextAuthorSlot % INSERT_COLORS.length);
    _nextAuthorSlot++;
  }
  return _authorIndexMap.get(authorID)!;
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
 * Adds `trackedInsert` and `trackedDelete` marks to the schema (opt-in),
 * intercepts all transactions via appendTransaction, and exposes commands
 * for toggling tracking status and accepting/rejecting changes.
 *
 * Commands:
 *   setTrackingStatus(status?)  — toggle or set tracking status
 *   setChangeStatuses(status, ids) — accept or reject changes; false when the plan is blocked
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
      trackedInsert: {
        attrs: {
          dataTracked: { default: null },
        },
        inclusive: false,
        // Allow multiple trackedInsert marks on the same text node segment
        // so that overlapping suggestions from different authors can coexist.
        // Each mark instance still carries a single author in dataTracked.
        excludes: "",
        parseDOM: [{ tag: "ins[data-tracked]" }],
        toDOM() {
          return ["ins", { "data-tracked": "insert" }, 0];
        },
      },
      trackedDelete: {
        attrs: {
          dataTracked: { default: null },
        },
        inclusive: false,
        // Same as trackedInsert — allow stacking from multiple authors.
        excludes: "",
        parseDOM: [{ tag: "del[data-tracked]" }],
        toDOM() {
          return ["del", { "data-tracked": "delete" }, 0];
        },
      },
    };
  },

  addCloneHandlers() {
    return [cloneTrackedChanges];
  },

  addExports() {
    return {
      semantic: {
        marks: { trackedDelete: dropDeleted, trackedInsert: keepInserted },
        isRemoved: proposedForDeletion,
        nodeChanges,
        isMarkRemoved,
      },
    };
  },

  // Markdown has no tracked changes of its own; CriticMarkup keeps a pending
  // suggestion readable rather than failing to serialize the document.
  addMarkdownSerializerRules() {
    return {
      marks: {
        trackedInsert: { open: "{++", close: "++}" },
        trackedDelete: { open: "{--", close: "--}" },
      },
    };
  },

  addProseMirrorPlugins() {
    const { userID } = this.options;
    const opts: TrackChangesOptions = { userID };
    if (this.options.initialStatus !== undefined) opts.initialStatus = this.options.initialStatus;
    if (this.options.canAcceptReject !== undefined) opts.canAcceptReject = this.options.canAcceptReject;
    if (this.options.skipTrsWithMetas !== undefined) opts.skipTrsWithMetas = this.options.skipTrsWithMetas;
    if (this.options.onRefused !== undefined) opts.onRefused = this.options.onRefused;
    return [
      trackChangesPlugin(opts),
      lastCutPlugin(),
    ];
  },

  addCommands() {
    return {
      setTrackingStatus:
        (status?: TrackChangesStatus) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
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
        (status: CHANGE_STATUS, ids: string[]) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          if (status === CHANGE_STATUS.pending) return false;
          const decisions = status === CHANGE_STATUS.accepted
            ? { accepted: ids, rejected: [] }
            : { accepted: [], rejected: ids };
          // Asks the shared rule rather than re-deriving it. A caller needing to
          // know *why* a decision was refused reads `reviewChanges` instead; a
          // command can only say whether it dispatched.
          if (planReviewIn(state, decisions).status === "blocked") return false;

          dispatch?.(setAction(state.tr, TrackChangesAction.setChangeStatuses, decisions));
          return true;
        },

      setTrackChangesUserID:
        (userID: string) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          dispatch?.(setAction(state.tr, TrackChangesAction.setUserID, userID));
          return true;
        },

      refreshChanges:
        () =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          dispatch?.(
            setAction(state.tr, TrackChangesAction.refreshChanges, true),
          );
          return true;
        },

      /**
       * Insert text as a pending suggestion, regardless of the current tracking
       * status. The inserted text gets a `trackedInsert` mark attributed to
       * `authorID`, and any replaced selection gets a `trackedDelete` mark.
       *
       * This is the correct way for AI assistants to propose edits — they always
       * show up as suggestions the user can accept or reject, never as direct edits.
       *
       * args: [text: string, from: number, to: number, authorID: string]
       */
      insertAsSuggestion:
        (text: string, from: number, to: number, authorID: string) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          const schema = state.schema;
          const insertMarkType = schema.marks.trackedInsert;
          const deleteMarkType = schema.marks.trackedDelete;
          if (!insertMarkType) return false; // TrackChanges not in schema

          const now = Date.now();
          const baseAttrs = createNewPendingAttrs(now, authorID);

          // A "\n" is the block's line break, as the semantic export reads one.
          const content = suggestedContent([{ text, marks: [] }], schema, state.doc.resolve(from).parent.type, createNewInsertAttrs(baseAttrs));

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
          tr.insert(from, content);

          // Prevent appendTransaction from trying to re-track this transaction.
          skipTracking(tr);
          // Ensure the changeSet is rebuilt so the new marks are visible.
          setAction(tr, TrackChangesAction.refreshChanges, true);

          dispatch?.(tr);
          return true;
        },
    };
  },

  onViewReady(editor: IEditor) {
    // Paint-only — tracked-changes data lives in plugin state regardless
    // of view. Headless editors never reach this hook.
    if (this.options.renderMode === "none") return;
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
      const movedTo = { glyphs: new Map<number, GlyphEntry>(), lines: new Map<number, LineEntry>() };
      const movedFrom = { glyphs: new Map<number, GlyphEntry>(), lines: new Map<number, LineEntry>() };
      const rows: Array<{ box: Box; color: string; removed: boolean }> = [];
      const pageBlocks = editor.layout.pages.find(page => page.pageNumber === pageNumber)?.blocks ?? [];
      // Conflict glyphs/lines are also deduplicated by position — without this,
      // N overlapping conflict changes push the same glyphs N times, causing
      // renderTrackedConflict to layer N semi-transparent amber fills at the
      // same pixels and produce a solid opaque orange block.
      const conflictGlyphsMap = new Map<number, GlyphEntry>();
      const conflictLinesMap = new Map<number, LineEntry>();
      // Block changes: keyed by lineIndex to avoid duplicate bars.
      const blockChangeLines = new Map<number, LineEntry>();

      const objects: Array<{ box: Box; color: string; removed: boolean }> = [];
      // Formatting changes how text looks, not whether it is there: washed and
      // barred in the margin as Word marks it, never struck or underlined.
      const formattedGlyphs = new Map<number, GlyphEntry>();
      const placements = (editor.layout.anchoredObjects ?? []).filter(placement => placement.page === pageNumber);

      const partOfRow = recordsInsideRowChanges(changeSet);

      for (const change of changeSet.changes) {
        if (partOfRow.has(change.id)) continue;
        const { operation, authorID } = change.dataTracked;
        const author = authorID ?? "unknown";
        const isConflict = !!change.dataTracked.isConflict;

        const glyphs = charMap.glyphsInRange(change.from, change.to)
          .filter(g => g.page === pageNumber);
        const lines = charMap.linesInRange(change.from, change.to)
          .filter(l => l.page === pageNumber);

        // An object has no text to underline or strike, so it is framed where it
        // is drawn: added or moved in, removed or moved out, or only changed.
        const framed = objectColor(operation, author);
        const node = change.type === "node-change" || change.type === "node-attr-change" ? change.node : null;
        const box = framed && node?.isLeaf ? objectBox(change.from, node, placements, charMap, pageNumber, lines) : null;
        if (framed && box) {
          objects.push({ box, color: framed, removed: operation === CHANGE_OPERATION.delete });
          continue;
        }
        if (change.type === "mark-change") {
          for (const g of glyphs) formattedGlyphs.set(g.docPos, g);
          for (const l of lines) if (!blockChangeLines.has(l.lineIndex)) blockChangeLines.set(l.lineIndex, l);
          continue;
        }

        // Moved content is marked as a move wherever it is, not as an insertion
        // or deletion; edits made inside a moved block draw over it.
        const moved = !!(change.dataTracked.moveNodeId || change.dataTracked.moveId);
        if (moved && (operation === CHANGE_OPERATION.move || operation === CHANGE_OPERATION.insert ||
          operation === CHANGE_OPERATION.delete)) {
          const into = operation === CHANGE_OPERATION.delete ? movedFrom : movedTo;
          for (const g of glyphs) into.glyphs.set(g.docPos, g);
          for (const l of lines) into.lines.set(l.lineIndex, l);
          continue;
        }

        if (isRowAddedOrRemoved(change)) {
          const row = pageBlocks.find(block => block.nodePos === change.from);
          if (row) {
            const removed = operation === CHANGE_OPERATION.delete;
            rows.push({ box: { x: row.x, y: row.y, width: row.width, height: row.height }, color: removed ? deleteColor(author) : insertColor(author), removed });
            continue;
          }
        }

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
        } else if (BLOCK_CHANGES.has(operation)) {
          // Draw a left-margin bar for every line of the changed block.
          for (const l of lines) {
            if (!blockChangeLines.has(l.lineIndex)) blockChangeLines.set(l.lineIndex, l);
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

      for (const { box, color, removed } of rows) renderTrackedRow(ctx, box, color, removed);
      renderTrackedMove(ctx, [...movedTo.glyphs.values()], [...movedTo.lines.values()], MOVE_COLOR, false);
      renderTrackedMove(ctx, [...movedFrom.glyphs.values()], [...movedFrom.lines.values()], MOVE_COLOR, true);

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

      for (const { box, color, removed } of objects) renderTrackedObject(ctx, box, color, removed);
      if (formattedGlyphs.size > 0) renderTrackedFormatting(ctx, [...formattedGlyphs.values()], ATTR_CHANGE_COLOR);

      // Block-change bars — rendered last so they're always visible
      if (blockChangeLines.size > 0) {
        renderTrackedAttrChange(ctx, [...blockChangeLines.values()], ATTR_CHANGE_COLOR);
      }
    };

    return editor.addOverlayRenderHandler(handler);
  },
});
