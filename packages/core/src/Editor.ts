import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import type { Extension } from "./extensions/Extension";
import { CursorManager } from "./renderer/CursorManager";
import { CharacterMap } from "./layout/CharacterMap";
import {
  insertText,
  deleteBackward,
  deleteForward,
  splitBlock,
} from "./model/commands";

export type EditorChangeHandler = (state: EditorState) => void;

/**
 * Snapshot of the current selection — passed to the rendering layer so it
 * can draw both the cursor and selection highlights without importing
 * ProseMirror types.
 */
export interface SelectionSnapshot {
  /** The fixed end of the selection (doesn't move when you Shift+arrow) */
  anchor: number;
  /** The moving end — where the cursor is drawn */
  head: number;
  /** Math.min(anchor, head) — start of the highlighted range */
  from: number;
  /** Math.max(anchor, head) — end of the highlighted range */
  to: number;
  /** True when anchor === head (cursor only, no highlight) */
  empty: boolean;
  /**
   * Names of marks active at the cursor (or present anywhere in the selection).
   * Use this to show toolbar button active states without importing ProseMirror.
   */
  activeMarks: string[];
}

export interface EditorOptions {
  /**
   * Extensions that define the schema, keymap, and commands.
   * Defaults to [StarterKit] — paragraph, heading, bold, italic, history.
   */
  extensions?: Extension[];
  onChange: EditorChangeHandler;
  /**
   * Called when the editor gains or loses focus.
   * Use this to show/hide the cursor overlay.
   * Framework-agnostic — works with React, Vue, plain HTML.
   */
  onFocusChange?: (focused: boolean) => void;
  /**
   * Called on every cursor blink tick (every 530ms) and immediately after
   * any user interaction that moves the cursor.
   *
   * The adapter (e.g. React PageView) should redraw the overlay canvas when
   * this fires. Receives `isVisible` so the overlay knows whether to draw
   * or clear the cursor.
   */
  onCursorTick?: (isVisible: boolean) => void;
  /**
   * The shared CharacterMap used by the renderer.
   * Required for ↑ ↓ vertical navigation — the editor needs to know glyph
   * positions to find the line above/below at the same x coordinate.
   */
  charMap?: CharacterMap;
}

/**
 * Editor — the single class consumers instantiate.
 *
 * Owns:
 *   - The ExtensionManager (schema, plugins, commands)
 *   - The ProseMirror EditorState (document + selection)
 *   - The hidden <textarea> that captures all keyboard input
 *
 * Does NOT own:
 *   - The <canvas> element — the renderer does
 *   - Layout — the layout engine does
 *
 * Usage:
 *   const editor = new Editor({ extensions: [StarterKit], onChange })
 *   editor.mount(containerElement)
 *   editor.destroy()
 *
 *   // Execute commands
 *   editor.commands.toggleBold()
 *   editor.commands.undo()
 */
export class Editor {
  private readonly manager: ExtensionManager;
  private state: EditorState;
  private textarea: HTMLTextAreaElement | null = null;
  private container: HTMLElement | null = null;
  private readonly onChange: EditorChangeHandler;
  private readonly onFocusChange: ((focused: boolean) => void) | undefined;
  private readonly charMap: CharacterMap | undefined;

  /** Owns the cursor blink timer. Public so adapters can read isVisible. */
  readonly cursorManager: CursorManager;

  /**
   * Bound command map — each entry calls the extension command with the
   * current state + this editor's dispatch. Built once; closures over `this`
   * so they always read the latest state at call time.
   */
  readonly commands: Record<string, (...args: unknown[]) => void>;

  constructor({ extensions = [StarterKit], onChange, onFocusChange, onCursorTick, charMap }: EditorOptions) {
    this.manager = new ExtensionManager(extensions);
    this.onChange = onChange;
    this.onFocusChange = onFocusChange;
    this.charMap = charMap;
    this.cursorManager = new CursorManager(() => {
      onCursorTick?.(this.cursorManager.isVisible);
    });

    this.state = EditorState.create({
      schema: this.manager.schema,
      plugins: this.manager.buildPlugins(),
    });

    this.commands = this.buildCommands();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * The merged ProseMirror Schema built from all extensions.
   * Use this instead of importing schema directly — it reflects whatever
   * extensions were loaded.
   */
  get schema(): Schema {
    return this.manager.schema;
  }

  getState(): EditorState {
    return this.state;
  }

  /**
   * Mount the editor onto a container element.
   * Creates the hidden textarea and attaches event listeners.
   */
  mount(container: HTMLElement): void {
    this.container = container;
    this.textarea = this.createHiddenTextarea();
    this.container.appendChild(this.textarea);
    this.attachListeners();
    this.textarea.focus();
  }

  destroy(): void {
    this.cursorManager.stop();
    if (this.textarea) {
      this.detachListeners();
      this.textarea.remove();
      this.textarea = null;
    }
    this.container = null;
  }

  focus(): void {
    this.textarea?.focus();
  }

  /**
   * Collapse the cursor to a specific doc position.
   * Safe to call with any integer — clamps and resolves to nearest valid text pos.
   */
  moveCursorTo(docPos: number): void {
    this.applyMovement(docPos, false);
    this.focus();
  }

  /**
   * Set an explicit anchor + head, creating a non-collapsed selection.
   * Used for Shift+click and click+drag.
   */
  setSelection(anchor: number, head: number): void {
    const size = this.state.doc.content.size;
    const a = Math.max(0, Math.min(anchor, size));
    const h = Math.max(0, Math.min(head, size));
    const $a = this.state.doc.resolve(a);
    const $h = this.state.doc.resolve(h);
    this.dispatch(
      this.state.tr.setSelection(TextSelection.between($a, $h))
    );
    this.focus();
  }

  /** Move left one position. Pass extend=true to grow the selection (Shift+←). */
  moveLeft(extend = false): void {
    const head = this.state.selection.head;
    if (head <= 0) return;
    const $pos = this.state.doc.resolve(Math.max(0, head - 1));
    this.applyMovement(TextSelection.near($pos, -1).head, extend);
  }

  /** Move right one position. Pass extend=true to grow the selection (Shift+→). */
  moveRight(extend = false): void {
    const head = this.state.selection.head;
    const size = this.state.doc.content.size;
    if (head >= size) return;
    const $pos = this.state.doc.resolve(Math.min(size, head + 1));
    this.applyMovement(TextSelection.near($pos, 1).head, extend);
  }

  /** Move up one line preserving x. Pass extend=true for Shift+↑. */
  moveUp(extend = false): void {
    if (!this.charMap) return;
    const head = this.state.selection.head;
    const coords = this.charMap.coordsAtPos(head);
    if (!coords) return;
    const pos = this.charMap.posAbove(head, coords.x);
    if (pos !== null) this.applyMovement(pos, extend);
  }

  /**
   * Returns the names of marks active at the current cursor/selection.
   *
   * - Collapsed cursor: uses stored marks (pending marks set by toggleMark) or
   *   the marks of the text node immediately before the cursor.
   * - Range selection: a mark is considered active only if it spans every text
   *   node in the range (matches toggleMark's "all-or-nothing" toggle logic).
   */
  getActiveMarks(): string[] {
    const { selection, storedMarks } = this.state;
    const { from, to, empty } = selection;

    if (empty) {
      const marks = storedMarks ?? selection.$from.marks();
      return marks.map((m) => m.type.name);
    }

    // Range: active = present on every text node in [from, to)
    return Object.keys(this.schema.marks).filter((name) => {
      const markType = this.schema.marks[name]!;
      let hasText = false;
      let allHaveMark = true;
      this.state.doc.nodesBetween(from, to, (node) => {
        if (node.isText) {
          hasText = true;
          if (!markType.isInSet(node.marks)) allHaveMark = false;
        }
      });
      return hasText && allHaveMark;
    });
  }

  /** Move down one line preserving x. Pass extend=true for Shift+↓. */
  moveDown(extend = false): void {
    if (!this.charMap) return;
    const head = this.state.selection.head;
    const coords = this.charMap.coordsAtPos(head);
    if (!coords) return;
    const pos = this.charMap.posBelow(head, coords.x);
    if (pos !== null) this.applyMovement(pos, extend);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Core movement primitive.
   *
   * extend=false → collapsed cursor at newHead
   * extend=true  → selection from current anchor to newHead (Shift+arrow / drag)
   */
  private applyMovement(newHead: number, extend: boolean): void {
    const size = this.state.doc.content.size;
    const h = Math.max(0, Math.min(newHead, size));
    const a = extend ? this.state.selection.anchor : h;
    // TextSelection.between resolves positions safely — handles node boundaries
    // and position 0 without throwing, unlike TextSelection.create.
    const $a = this.state.doc.resolve(Math.max(0, Math.min(a, size)));
    const $h = this.state.doc.resolve(h);
    this.dispatch(
      this.state.tr.setSelection(TextSelection.between($a, $h))
    );
  }

  private dispatch(tr: Transaction | null): void {
    if (!tr) return;
    this.state = this.state.apply(tr);
    this.cursorManager.reset();
    this.onChange(this.state);
  }

  /**
   * Build bound command wrappers.
   * Each wrapper reads `this.state` at call time (not construction time)
   * because the closure captures `this` by reference.
   */
  private buildCommands(): Record<string, (...args: unknown[]) => void> {
    const rawCommands = this.manager.buildCommands();
    const bound: Record<string, (...args: unknown[]) => void> = {};

    for (const [name, factory] of Object.entries(rawCommands)) {
      bound[name] = (...args: unknown[]) => {
        const cmd = factory(...args);
        cmd(this.state, (tr) => this.dispatch(tr));
      };
    }

    return bound;
  }

  private createHiddenTextarea(): HTMLTextAreaElement {
    const ta = document.createElement("textarea");

    Object.assign(ta.style, {
      position: "absolute",
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
      top: "0",
      left: "0",
    });

    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("spellcheck", "false");
    // aria-hidden on a focused element is invalid — the textarea IS the
    // keyboard/IME input bridge, so screen readers should be able to reach it.
    ta.setAttribute("role", "textbox");
    ta.setAttribute("aria-multiline", "true");
    ta.setAttribute("aria-label", "Document editor");
    ta.setAttribute("tabindex", "0");

    return ta;
  }

  private attachListeners(): void {
    const ta = this.textarea!;
    ta.addEventListener("keydown", this.handleKeydown);
    ta.addEventListener("input", this.handleInput);
    ta.addEventListener("compositionend", this.handleCompositionEnd);
    ta.addEventListener("paste", this.handlePaste);
    ta.addEventListener("focus", this.handleFocus);
    ta.addEventListener("blur", this.handleBlur);
  }

  private detachListeners(): void {
    const ta = this.textarea!;
    ta.removeEventListener("keydown", this.handleKeydown);
    ta.removeEventListener("input", this.handleInput);
    ta.removeEventListener("compositionend", this.handleCompositionEnd);
    ta.removeEventListener("paste", this.handlePaste);
    ta.removeEventListener("focus", this.handleFocus);
    ta.removeEventListener("blur", this.handleBlur);
  }

  private handleFocus = (): void => {
    this.cursorManager.start();
    this.onFocusChange?.(true);
  };

  private handleBlur = (): void => {
    this.cursorManager.stop();
    this.onFocusChange?.(false);
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.moveLeft(e.shiftKey);
      return;
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      this.moveRight(e.shiftKey);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.moveUp(e.shiftKey);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.moveDown(e.shiftKey);
      return;
    }

    if (mod && e.key === "b") {
      e.preventDefault();
      this.commands["toggleBold"]?.();
      return;
    }

    if (mod && e.key === "i") {
      e.preventDefault();
      this.commands["toggleItalic"]?.();
      return;
    }

    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.commands["undo"]?.();
      this.clearTextarea();
      return;
    }

    if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      this.commands["redo"]?.();
      this.clearTextarea();
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      this.dispatch(deleteBackward(this.state));
      this.clearTextarea();
      return;
    }

    if (e.key === "Delete") {
      e.preventDefault();
      this.dispatch(deleteForward(this.state));
      this.clearTextarea();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this.dispatch(splitBlock(this.state));
      this.clearTextarea();
      return;
    }
  };

  private handleInput = (e: Event): void => {
    if ((e as InputEvent).isComposing) return;
    const text = this.textarea!.value;
    if (!text) return;
    this.dispatch(insertText(this.state, text));
    this.clearTextarea();
  };

  private handleCompositionEnd = (e: CompositionEvent): void => {
    const text = e.data;
    if (!text) return;
    this.dispatch(insertText(this.state, text));
    this.clearTextarea();
  };

  private handlePaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    this.dispatch(insertText(this.state, text));
  };

  private clearTextarea(): void {
    if (this.textarea) this.textarea.value = "";
  }
}
