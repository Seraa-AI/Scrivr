import { TextSelection } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { CharacterMap } from "./layout/CharacterMap";
import type { EditorNavigator } from "./extensions/types";

/**
 * Dependencies injected into SelectionController — no direct coupling to Editor.
 * All callbacks are read at call time, never cached.
 */
export interface SelectionControllerDeps {
  /** Current ProseMirror state. */
  getState: () => EditorState;
  /** View-aware dispatch — triggers layout invalidation + rAF paint. */
  dispatch: (tr: Transaction) => void;
  /** Ensure layout is up to date before CharacterMap queries. */
  ensureLayout: () => void;
  /** The CharacterMap for vertical movement and line start/end lookups. */
  getCharMap: () => CharacterMap;
  /** Focus the hidden textarea (re-captures keyboard input). */
  focus: () => void;
}

/**
 * SelectionController — owns all cursor movement, selection, and word/line
 * navigation logic.
 *
 * Extracted from Editor to keep it a thin orchestrator. This class is
 * independently testable and reusable for mobile, collaborative cursors,
 * and accessibility.
 *
 * Implements EditorNavigator so it can be passed directly to InputBridge
 * as the navigator for keyboard input handlers.
 */
export class SelectionController implements EditorNavigator {
  constructor(private readonly deps: SelectionControllerDeps) {}

  // ── Atomic movement primitives ──────────────────────────────────────────────

  /** Collapse the cursor to a specific doc position. */
  moveCursorTo(docPos: number): void {
    this._applyMovement(docPos, false);
    this.deps.focus();
  }

  /** Set an explicit anchor + head, creating a non-collapsed selection. */
  setSelection(anchor: number, head: number): void {
    const state = this.deps.getState();
    const size = state.doc.content.size;
    const a = Math.max(0, Math.min(anchor, size));
    const h = Math.max(0, Math.min(head, size));
    const $a = state.doc.resolve(a);
    const $h = state.doc.resolve(h);
    this.deps.dispatch(state.tr.setSelection(TextSelection.between($a, $h)));
    this.deps.focus();
  }

  // ── Direction-based movement ────────────────────────────────────────────────

  /** Move left one position. Pass extend=true to grow the selection (Shift+←). */
  moveLeft(extend = false): void {
    const state = this.deps.getState();
    const head = state.selection.head;
    if (head <= 0) return;
    const $pos = state.doc.resolve(Math.max(0, head - 1));
    const sel = TextSelection.findFrom($pos, -1);
    if (sel) this._applyMovement(sel.head, extend);
  }

  /** Move right one position. Pass extend=true to grow the selection (Shift+→). */
  moveRight(extend = false): void {
    const state = this.deps.getState();
    const head = state.selection.head;
    const size = state.doc.content.size;
    if (head >= size) return;
    const $pos = state.doc.resolve(Math.min(size, head + 1));
    const sel = TextSelection.findFrom($pos, 1);
    if (sel) this._applyMovement(sel.head, extend);
  }

  /** Move up one line preserving x. Pass extend=true for Shift+↑. */
  moveUp(extend = false): void {
    this.deps.ensureLayout();
    const head = this.deps.getState().selection.head;
    const coords = this.deps.getCharMap().coordsAtPos(head);
    if (!coords) return;
    const pos = this.deps.getCharMap().posAbove(head, coords.x);
    if (pos !== null) this._applyMovement(pos, extend);
  }

  /** Move down one line preserving x. Pass extend=true for Shift+↓. */
  moveDown(extend = false): void {
    this.deps.ensureLayout();
    const head = this.deps.getState().selection.head;
    const coords = this.deps.getCharMap().coordsAtPos(head);
    if (!coords) return;
    const pos = this.deps.getCharMap().posBelow(head, coords.x);
    if (pos !== null) this._applyMovement(pos, extend);
  }

  /** Move cursor to the previous word boundary. */
  moveWordLeft(extend = false): void {
    const head = this.deps.getState().selection.head;
    const pos = this._findWordBoundary(head, -1);
    if (pos !== head) this._applyMovement(pos, extend);
  }

  /** Move cursor to the next word boundary. */
  moveWordRight(extend = false): void {
    const head = this.deps.getState().selection.head;
    const pos = this._findWordBoundary(head, 1);
    if (pos !== head) this._applyMovement(pos, extend);
  }

  /** Move to start of the current visual line. */
  moveToLineStart(extend = false): void {
    this.deps.ensureLayout();
    const head = this.deps.getState().selection.head;
    const pos = this.deps.getCharMap().lineStartPos(head);
    if (pos !== null) this._applyMovement(pos, extend);
  }

  /** Move to end of the current visual line. */
  moveToLineEnd(extend = false): void {
    this.deps.ensureLayout();
    const head = this.deps.getState().selection.head;
    const pos = this.deps.getCharMap().lineEndPos(head);
    if (pos !== null) this._applyMovement(pos, extend);
  }

  /** Move to start of document. */
  moveToDocStart(extend = false): void {
    const $pos = this.deps.getState().doc.resolve(0);
    const sel = TextSelection.findFrom($pos, 1);
    if (sel) this._applyMovement(sel.head, extend);
  }

  /** Move to end of document. */
  moveToDocEnd(extend = false): void {
    const size = this.deps.getState().doc.content.size;
    const $pos = this.deps.getState().doc.resolve(size);
    const sel = TextSelection.findFrom($pos, -1);
    if (sel) this._applyMovement(sel.head, extend);
  }

  // ── Selection by unit ───────────────────────────────────────────────────────

  /**
   * Select the word at the given doc position.
   * Returns { from, to } of the word boundaries.
   */
  selectWordAt(pos: number): { from: number; to: number } {
    const from = this._findWordBoundary(pos, -1);
    const to = this._findWordBoundary(pos, 1);
    this.setSelection(from, to);
    return { from, to };
  }

  /** Select the entire block (paragraph/heading) containing the given position. */
  selectBlockAt(pos: number): void {
    const $pos = this.deps.getState().doc.resolve(pos);
    const blockStart = $pos.start($pos.depth);
    const blockEnd = $pos.end($pos.depth);
    this.setSelection(blockStart, blockEnd);
  }

  /**
   * Public access to word boundary scanning — used by TileManager
   * for word-granularity drag selection after double-click.
   */
  wordBoundary(pos: number, dir: -1 | 1): number {
    return this._findWordBoundary(pos, dir);
  }

  // ── Deletion by unit ────────────────────────────────────────────────────────

  /** Delete from cursor to previous word boundary. */
  deleteWordBackward(): void {
    const state = this.deps.getState();
    const { head, empty } = state.selection;
    if (!empty) {
      this.deps.dispatch(state.tr.deleteSelection());
      return;
    }
    const wordStart = this._findWordBoundary(head, -1);
    if (wordStart < head) {
      this.deps.dispatch(state.tr.delete(wordStart, head));
    }
  }

  /** Delete from cursor to next word boundary. */
  deleteWordForward(): void {
    const state = this.deps.getState();
    const { head, empty } = state.selection;
    if (!empty) {
      this.deps.dispatch(state.tr.deleteSelection());
      return;
    }
    const wordEnd = this._findWordBoundary(head, 1);
    if (wordEnd > head) {
      this.deps.dispatch(state.tr.delete(head, wordEnd));
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Core movement primitive.
   * extend=false → collapsed cursor at newHead
   * extend=true  → selection from current anchor to newHead (Shift+arrow)
   */
  private _applyMovement(newHead: number, extend: boolean): void {
    const state = this.deps.getState();
    const size = state.doc.content.size;
    const h = Math.max(0, Math.min(newHead, size));
    const a = extend ? state.selection.anchor : h;
    const $a = state.doc.resolve(Math.max(0, Math.min(a, size)));
    const $h = state.doc.resolve(h);
    this.deps.dispatch(state.tr.setSelection(TextSelection.between($a, $h)));
  }

  /**
   * Find the next word boundary from `pos` in `dir` (-1 = left, 1 = right).
   * Matches native text editor behaviour: skip whitespace, then skip word chars
   * (or vice versa depending on what's under the cursor).
   */
  private _findWordBoundary(pos: number, dir: -1 | 1): number {
    const doc = this.deps.getState().doc;
    const size = doc.content.size;

    const $pos = doc.resolve(pos);
    const blockStart = $pos.start($pos.depth);
    const blockEnd = $pos.end($pos.depth);
    const blockText = doc.textBetween(blockStart, blockEnd);

    let offset = pos - blockStart;
    const ch = (i: number): string => blockText.charAt(i);

    if (dir === -1) {
      while (offset > 0 && isWhitespace(ch(offset - 1))) offset--;
      if (offset > 0 && isWordChar(ch(offset - 1))) {
        while (offset > 0 && isWordChar(ch(offset - 1))) offset--;
      } else {
        while (offset > 0 && !isWordChar(ch(offset - 1)) && !isWhitespace(ch(offset - 1))) offset--;
      }
    } else {
      const len = blockText.length;
      while (offset < len && isWhitespace(ch(offset))) offset++;
      if (offset < len && isWordChar(ch(offset))) {
        while (offset < len && isWordChar(ch(offset))) offset++;
      } else {
        while (offset < len && !isWordChar(ch(offset)) && !isWhitespace(ch(offset))) offset++;
      }
    }

    return Math.max(0, Math.min(blockStart + offset, size));
  }
}

// ── Module-level helpers ────────────────────────────────────────────────────

/** Word character: letters, digits, underscore (matches \w). */
function isWordChar(ch: string): boolean {
  return /\w/.test(ch);
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}
