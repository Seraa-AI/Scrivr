import { EditorState, Transaction } from "prosemirror-state";
import { createEditorState } from "./model/state";
import {
  insertText,
  deleteBackward,
  deleteForward,
  splitBlock,
  applyUndo,
  applyRedo,
} from "./model/commands";

export type EditorChangeHandler = (state: EditorState) => void;

/**
 * Editor — the single class consumers instantiate.
 *
 * Owns:
 *   - The ProseMirror EditorState (document + selection)
 *   - The hidden <textarea> that captures all keyboard input
 *
 * Does NOT own:
 *   - The <canvas> element — the renderer does
 *   - Layout — the layout engine does
 *
 * Usage:
 *   const editor = new Editor({ onChange: (state) => render(state) })
 *   editor.mount(canvasContainerElement)
 *   editor.destroy()
 */
export class Editor {
  private state: EditorState;
  private textarea: HTMLTextAreaElement | null = null;
  private container: HTMLElement | null = null;
  private onChange: EditorChangeHandler;

  constructor({ onChange }: { onChange: EditorChangeHandler }) {
    this.state = createEditorState();
    this.onChange = onChange;
  }

  getState(): EditorState {
    return this.state;
  }

  /**
   * Mount the editor onto a container element.
   * Creates the hidden textarea and attaches event listeners.
   * The container should be the same element wrapping your <canvas>.
   */
  mount(container: HTMLElement): void {
    this.container = container;
    this.textarea = this.createHiddenTextarea();
    this.container.appendChild(this.textarea);
    this.attachListeners();
    this.textarea.focus();
  }

  destroy(): void {
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

  // ── Private ────────────────────────────────────────────────────────────────

  private dispatch(tr: Transaction | null): void {
    if (!tr) return;
    this.state = this.state.apply(tr);
    this.onChange(this.state);
  }

  private createHiddenTextarea(): HTMLTextAreaElement {
    const ta = document.createElement("textarea");

    // Visually hidden but accessible to the browser for input/IME
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
      // Position near the virtual cursor so IME popups appear nearby
      top: "0",
      left: "0",
    });

    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("spellcheck", "false");
    ta.setAttribute("aria-hidden", "true");
    ta.setAttribute("tabindex", "-1");

    return ta;
  }

  private attachListeners(): void {
    const ta = this.textarea!;
    ta.addEventListener("keydown", this.handleKeydown);
    ta.addEventListener("input", this.handleInput);
    ta.addEventListener("compositionend", this.handleCompositionEnd);
  }

  private detachListeners(): void {
    const ta = this.textarea!;
    ta.removeEventListener("keydown", this.handleKeydown);
    ta.removeEventListener("input", this.handleInput);
    ta.removeEventListener("compositionend", this.handleCompositionEnd);
  }

  /**
   * Handle control keys before the browser processes the input event.
   * Returning early prevents duplicate handling.
   */
  private handleKeydown = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.dispatch(applyUndo(this.state));
      this.clearTextarea();
      return;
    }

    if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      this.dispatch(applyRedo(this.state));
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

  /**
   * Handle printable character input.
   * The browser has already placed the character in the textarea value —
   * read it, dispatch the transaction, then clear the textarea.
   */
  private handleInput = (e: Event): void => {
    const ta = this.textarea!;

    // Skip during IME composition — wait for compositionend
    if ((e as InputEvent).isComposing) return;

    const text = ta.value;
    if (!text) return;

    this.dispatch(insertText(this.state, text));
    this.clearTextarea();
  };

  /**
   * IME composition finished — commit the composed text.
   */
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
