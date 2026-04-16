import type { EditorState, Transaction, Command } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import type { CharacterMap } from "../layout/CharacterMap";
import type { InputHandler, EditorNavigator } from "../extensions/types";
import type { PasteTransformer } from "./PasteTransformer";
import { insertText, deleteSelection } from "../model/commands";
import { serializeSelectionToHtml } from "./ClipboardSerializer";

/**
 * Convert a DOM KeyboardEvent into a ProseMirror key string.
 *
 * Format: [Mod-][Alt-][Shift-]key
 *   - "Mod" = Cmd on Mac, Ctrl on Windows/Linux
 *   - Single-character keys are lowercased (Shift is already in the prefix)
 *   - Special keys keep their DOM name: "Enter", "Backspace", "Delete", "Tab"
 *
 * Examples: Cmd+B → "Mod-b", Cmd+Shift+Z → "Mod-Shift-z", Enter → "Enter"
 */
export function keyEventToString(e: KeyboardEvent): string {
  let key = e.key;
  let prefix = "";
  if (e.metaKey || e.ctrlKey) prefix += "Mod-";
  if (e.altKey) prefix += "Alt-";
  if (e.shiftKey) prefix += "Shift-";

  // On macOS, Option (Alt) transforms e.key into special characters
  // (e.g. Option+1 → "¡", Option+b → "∫"). Fall back to e.code so that
  // Mod-Alt-1 and similar bindings resolve correctly.
  if (e.altKey && key.length === 1 && !/^[a-zA-Z0-9]$/.test(key)) {
    if (e.code.startsWith("Digit"))
      key = e.code.slice(5); // "Digit1" → "1"
    else if (e.code.startsWith("Key")) key = e.code.slice(3); // "KeyB"   → "B"
  }

  // Normalize space to "Space" — ProseMirror convention.
  if (key === " ") key = "Space";

  // Single-character keys: lowercase so "Mod-b" matches whether or not Shift
  // is held (Cmd+Shift+Z gives e.key="Z" — we want "Mod-Shift-z").
  if (key.length === 1) key = key.toLowerCase();
  return prefix + key;
}

export interface InputBridgeOptions {
  /** Current ProseMirror state — read at event time, never cached. */
  getState: () => EditorState;
  /** Dispatch a transaction (or null = no-op) produced by an event handler. */
  dispatch: (tr: Transaction | null) => void;
  /** Schema — used by ClipboardSerializer for copy/cut. */
  getSchema: () => Schema;
  /** Viewport rect for a doc-position range — used to position the textarea. */
  getViewportRect: (from: number, to: number) => DOMRect | null;
  /** CharacterMap — used by scrollCursorIntoView for cursor coordinates. */
  getCharMap: () => CharacterMap;
  /**
   * Returns the visual page/y/height for a float at docPos, or null when
   * the position is not a float. Used by scrollCursorIntoView to scroll to
   * the float's actual rendered page rather than the anchor span's page.
   */
  getFloatPosition?: (
    docPos: number,
  ) => { page: number; y: number; height: number } | null;
  /** Keymap built from all extensions — consulted on every keydown. */
  keymap: Record<string, Command>;
  /** Input handlers from all extensions — consulted before the keymap.
   *  Each handler receives an EditorNavigator (movement API) + the raw event. */
  inputHandlers: Record<string, InputHandler>;
  /** Navigator passed to InputHandler calls — normally the Editor itself. */
  navigator: EditorNavigator;
  /** Handles paste transformation from clipboard data. */
  pasteTransformer: PasteTransformer;
  /** Called when the textarea gains focus. */
  onFocus: () => void;
  /** Called when the textarea loses focus. */
  onBlur: () => void;
}

/**
 * Owns the hidden <textarea> that captures all keyboard / IME / clipboard input.
 *
 * Responsibilities:
 *  - Creates and styles the textarea on mount()
 *  - Attaches / detaches the 8 DOM event listeners
 *  - Translates DOM events into ProseMirror transactions via dispatch()
 *  - Positions the textarea at the cursor (syncPosition) for IME and scroll
 *  - Scrolls the nearest scroll ancestor to keep the cursor visible
 *
 * Does NOT own: ProseMirror state, layout, or rendering.
 */
export class InputBridge {
  private readonly opts: InputBridgeOptions;

  private textarea: HTMLTextAreaElement | null = null;
  private _container: HTMLElement | null = null;
  private pageScreenRectLookup:
    | ((page: number) => { screenLeft: number; screenTop: number } | null)
    | null = null;
  private _isFocused = false;
  private _readOnly = false;

  constructor(opts: InputBridgeOptions) {
    this.opts = opts;
  }

  /** Public API */

  /** True when the textarea currently has DOM focus. */
  get isFocused(): boolean {
    return this._isFocused;
  }

  /** Block or unblock all document mutations. */
  setReadOnly(value: boolean): void {
    this._readOnly = value;
  }

  /** The container element passed to mount(). Null when unmounted. */
  get container(): HTMLElement | null {
    return this._container;
  }

  /** Resolve a 1-based page number to its screen-space top-left corner. */
  lookupPageScreenRect(
    page: number,
  ): { screenLeft: number; screenTop: number } | null {
    return this.pageScreenRectLookup?.(page) ?? null;
  }

  /**
   * Create the textarea, append it to the container, and focus it.
   * Safe to call only once — unmount() before re-mounting.
   */
  mount(container: HTMLElement): void {
    this._container = container;
    this.textarea = this._createTextarea();
    this._container.appendChild(this.textarea);
    this._attachListeners();
    // preventScroll: guards against browsers scrolling a position:fixed element
    // on focus (rare but observed in some browser versions).
    this.textarea.focus({ preventScroll: true });
  }

  /**
   * Remove the textarea and detach all event listeners.
   * Safe to call multiple times.
   */
  unmount(): void {
    if (this.textarea) {
      this._detachListeners();
      this.textarea.remove();
      this.textarea = null;
    }
    this._container = null;
    this.pageScreenRectLookup = null;
  }

  /** Programmatically focus the textarea (re-captures keyboard input). */
  focus(): void {
    this.textarea?.focus({ preventScroll: true });
  }

  /**
   * Register the adapter's page screen-rect resolver.
   * Returns the screen-space {screenLeft, screenTop} of page N's top-left corner.
   * Used by scrollCursorIntoView(), getViewportRect(), and getNodeViewportRect().
   * Pass null to clear.
   */
  setPageScreenRectLookup(
    fn:
      | ((page: number) => { screenLeft: number; screenTop: number } | null)
      | null,
  ): void {
    this.pageScreenRectLookup = fn;
  }

  /**
   * Move the textarea to the cursor's current viewport position.
   *
   * Without this the textarea sits at top:0, causing the browser to scroll
   * back to the top on every keystroke. Also critical for mobile IME —
   * positions the suggestion bar and magnifier near the actual cursor.
   */
  syncPosition(): void {
    if (!this.textarea) return;
    // Defer to the caller to decide whether surface-active runs through this
    // path. When `getViewportRect` can't resolve `head` (happens when a
    // surface is active and head is a surface-doc position being interpreted
    // against flow layout), leave the textarea where it was rather than
    // positioning it to garbage coordinates.
    const { head } = this.opts.getState().selection;
    const rect = this.opts.getViewportRect(head, head);
    if (!rect) return;
    Object.assign(this.textarea.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      height: `${rect.height}px`,
    });
  }

  /**
   * Scroll the nearest scrollable ancestor so the cursor stays visible.
   * Called after every state change and after React renders new pages.
   */
  scrollCursorIntoView(): void {
    if (!this._container || !this.pageScreenRectLookup) return;
    const sel = this.opts.getState().selection;
    const { head } = sel;

    // Float nodes: their anchor glyph is registered on the anchor paragraph's
    // page (always page 1 when overflowed to page 2+). Use the float's actual
    // rendered position instead so we scroll to the correct page.
    // NodeSelection: anchor = from (position before the node), head = to = from + nodeSize.
    // layout.floats stores docPos = from, so we look up sel.from, not head.
    const floatPos = this.opts.getFloatPosition?.(sel.from);
    const coords = floatPos
      ? { page: floatPos.page, y: floatPos.y, height: floatPos.height }
      : this.opts.getCharMap().coordsAtPos(head);
    if (!coords) return;

    const scrollParent = findScrollParent(this._container);
    if (!scrollParent) return;

    // Convert screen-space page top to absolute Y within the scroll container.
    const pageScreenRect = this.pageScreenRectLookup(coords.page);
    if (!pageScreenRect) return;
    const containerRect = scrollParent.getBoundingClientRect();
    const pageTop =
      pageScreenRect.screenTop - containerRect.top + scrollParent.scrollTop;

    const cursorAbsTop = pageTop + coords.y;
    const cursorAbsBottom = cursorAbsTop + coords.height;
    const visibleTop = scrollParent.scrollTop;
    const visibleBottom = visibleTop + scrollParent.clientHeight;
    const buffer = 40;

    if (cursorAbsBottom > visibleBottom - buffer) {
      scrollParent.scrollTop =
        cursorAbsBottom - scrollParent.clientHeight + buffer;
    } else if (cursorAbsTop < visibleTop + buffer) {
      scrollParent.scrollTop = cursorAbsTop - buffer;
    }
  }

  /** Private — textarea creation */

  private _createTextarea(): HTMLTextAreaElement {
    const ta = document.createElement("textarea");
    Object.assign(ta.style, {
      position: "fixed",
      opacity: "0",
      width: "1px",
      height: "1px",
      padding: "0",
      border: "none",
      margin: "0",
      overflow: "hidden",
      resize: "none",
      outline: "none",
      pointerEvents: "none",
      top: "-9999px",
      left: "-9999px",
    });
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("spellcheck", "false");
    // aria-hidden on a focused element is invalid — this textarea IS the
    // keyboard/IME bridge, so screen readers must be able to reach it.
    ta.setAttribute("role", "textbox");
    ta.setAttribute("aria-multiline", "true");
    ta.setAttribute("aria-label", "Document editor");
    ta.setAttribute("tabindex", "0");
    return ta;
  }

  /** Private — event wiring */

  private _attachListeners(): void {
    const ta = this.textarea!;
    ta.addEventListener("keydown", this._handleKeydown);
    ta.addEventListener("input", this._handleInput);
    ta.addEventListener("compositionend", this._handleCompositionEnd);
    ta.addEventListener("paste", this._handlePaste);
    ta.addEventListener("copy", this._handleCopy);
    ta.addEventListener("cut", this._handleCut);
    ta.addEventListener("focus", this._handleFocus);
    ta.addEventListener("blur", this._handleBlur);
  }

  private _detachListeners(): void {
    const ta = this.textarea!;
    ta.removeEventListener("keydown", this._handleKeydown);
    ta.removeEventListener("input", this._handleInput);
    ta.removeEventListener("compositionend", this._handleCompositionEnd);
    ta.removeEventListener("paste", this._handlePaste);
    ta.removeEventListener("copy", this._handleCopy);
    ta.removeEventListener("cut", this._handleCut);
    ta.removeEventListener("focus", this._handleFocus);
    ta.removeEventListener("blur", this._handleBlur);
  }

  /** Private — event handlers */

  private _handleFocus = (): void => {
    this._isFocused = true;
    this.opts.onFocus();
  };

  private _handleBlur = (): void => {
    this._isFocused = false;
    this.opts.onBlur();
  };

  private _handleKeydown = (e: KeyboardEvent): void => {
    if (this._readOnly) {
      // Allow arrow-key navigation and selection-only shortcuts; block all mutations.
      const keyStr = keyEventToString(e);
      // Escape collapses the current selection without moving the cursor.
      if (e.key === "Escape") {
        const state = this.opts.getState();
        const { head } = state.selection;
        this.opts.dispatch(state.tr.setSelection(TextSelection.create(state.doc, head)));
        e.preventDefault();
        return;
      }
      if (this._tryInputHandler(e)) {
        e.preventDefault();
        return;
      }
      // Mod-a (select all) and Mod-c (copy, also handled by clipboard event)
      if ((keyStr === "Mod-a" || keyStr === "Mod-c") && this._tryKeymapCommand(e)) {
        e.preventDefault();
        this._clearTextarea();
      }
      return;
    }
    // Input handlers first — editor-level actions (navigation, etc.)
    // declared by extensions via addInputHandlers().
    if (this._tryInputHandler(e)) {
      e.preventDefault();
      return;
    }
    // Tab must always be captured so the browser never shifts focus away.
    if (e.key === "Tab") e.preventDefault();
    // Then document-level commands declared by extensions via addKeymap().
    if (this._tryKeymapCommand(e)) {
      e.preventDefault();
      this._clearTextarea();
    }
  };

  private _handleInput = (e: Event): void => {
    if (this._readOnly) return;
    if ((e as InputEvent).isComposing) return;
    const text = this.textarea!.value;
    if (!text) return;
    this.opts.dispatch(insertText(this.opts.getState(), text));
    this._clearTextarea();
  };

  private _handleCompositionEnd = (e: CompositionEvent): void => {
    if (this._readOnly) return;
    const text = e.data;
    if (!text) return;
    // Clear BEFORE dispatching: Chrome/Edge fires `input` with isComposing=false
    // immediately after compositionend. Clearing first prevents double-insert.
    this._clearTextarea();
    this.opts.dispatch(insertText(this.opts.getState(), text));
  };

  private _handleCopy = (e: ClipboardEvent): void => {
    const state = this.opts.getState();
    const { from, to, empty } = state.selection;
    if (empty || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData(
      "text/plain",
      state.doc.textBetween(from, to, "\n"),
    );
    const html = serializeSelectionToHtml(state, this.opts.getSchema());
    if (html) e.clipboardData.setData("text/html", html);
  };

  private _handleCut = (e: ClipboardEvent): void => {
    const state = this.opts.getState();
    const { from, to, empty } = state.selection;
    if (empty || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData(
      "text/plain",
      state.doc.textBetween(from, to, "\n"),
    );
    const html = serializeSelectionToHtml(state, this.opts.getSchema());
    if (html) e.clipboardData.setData("text/html", html);
    // In read-only mode, honour copy but skip the delete.
    if (this._readOnly) return;
    const tr = deleteSelection(state);
    if (tr) this.opts.dispatch(tr);
  };

  private _handlePaste = (e: ClipboardEvent): void => {
    if (this._readOnly) return;
    e.preventDefault();
    if (!e.clipboardData) return;
    const tr = this.opts.pasteTransformer.transform(
      e.clipboardData,
      this.opts.getState(),
    );
    if (tr) this.opts.dispatch(tr);
  };

  /** Private — helpers */

  private _tryInputHandler(e: KeyboardEvent): boolean {
    // Try the fully-qualified key first (e.g. "Alt-ArrowLeft" for word-jump),
    // then fall back to the bare key so that handlers which read modifier state
    // directly (like BaseEditing's arrow handlers) still fire.
    const handler =
      this.opts.inputHandlers[keyEventToString(e)] ??
      this.opts.inputHandlers[e.key];
    if (!handler) return false;
    return handler(this.opts.navigator, e);
  }

  private _tryKeymapCommand(e: KeyboardEvent): boolean {
    const keyStr = keyEventToString(e);
    const cmd = this.opts.keymap[keyStr];
    if (!cmd) return false;
    return cmd(this.opts.getState(), (tr) => {
      tr.setMeta("uiEvent", keyStr);
      this.opts.dispatch(tr);
    });
  }

  private _clearTextarea(): void {
    if (this.textarea) this.textarea.value = "";
  }
}

/** Module-level helpers */

export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  let current = el.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return null;
}
