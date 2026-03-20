import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import type { Extension } from "./extensions/Extension";
import { CursorManager } from "./renderer/CursorManager";
import {
  insertText,
  deleteBackward,
  deleteForward,
  splitBlock,
} from "./model/commands";

export type EditorChangeHandler = (state: EditorState) => void;

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

  /** Owns the cursor blink timer. Public so adapters can read isVisible. */
  readonly cursorManager: CursorManager;

  /**
   * Bound command map — each entry calls the extension command with the
   * current state + this editor's dispatch. Built once; closures over `this`
   * so they always read the latest state at call time.
   */
  readonly commands: Record<string, (...args: unknown[]) => void>;

  constructor({ extensions = [StarterKit], onChange, onFocusChange, onCursorTick }: EditorOptions) {
    this.manager = new ExtensionManager(extensions);
    this.onChange = onChange;
    this.onFocusChange = onFocusChange;
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
   * Move the cursor (collapsed selection) to a specific ProseMirror doc position.
   *
   * Call this after hit-testing a click against the CharacterMap:
   *   const pos = charMap.posAtCoords(x, y, pageNumber);
   *   editor.moveCursorTo(pos);
   */
  moveCursorTo(docPos: number): void {
    // Clamp to document bounds then resolve — position 0 is before the doc
    // node itself and not valid for a TextSelection. TextSelection.near()
    // finds the closest valid inline position from any resolved pos.
    const size = this.state.doc.content.size;
    const clamped = Math.max(0, Math.min(docPos, size));
    const $pos = this.state.doc.resolve(clamped);
    const sel = TextSelection.near($pos);
    const tr = this.state.tr.setSelection(sel);
    this.dispatch(tr);
    this.focus();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

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
    ta.addEventListener("focus", this.handleFocus);
    ta.addEventListener("blur", this.handleBlur);
  }

  private detachListeners(): void {
    const ta = this.textarea!;
    ta.removeEventListener("keydown", this.handleKeydown);
    ta.removeEventListener("input", this.handleInput);
    ta.removeEventListener("compositionend", this.handleCompositionEnd);
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

  private clearTextarea(): void {
    if (this.textarea) this.textarea.value = "";
  }
}
