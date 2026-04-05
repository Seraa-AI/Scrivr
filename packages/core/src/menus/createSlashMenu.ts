/**
 * createSlashMenu — framework-agnostic controller for a "/" slash command menu.
 *
 * Shows when the user types "/" at the start of an empty text block.
 * The caller is responsible for rendering and keyboard handling.
 *
 * @example — vanilla JS
 *   const { cleanup, dismissMenu } = createSlashMenu(editor, {
 *     onShow:   (rect, query, slashFrom) => { menu.style.display = "block"; filterItems(query); },
 *     onUpdate: (rect, query, slashFrom) => { filterItems(query); },
 *     onHide:   ()                       => { menu.style.display = "none"; },
 *   });
 *   // when user selects an item:
 *   //   1. delete slashFrom..cursor via editor._applyTransaction(state.tr.delete(slashFrom, cursor))
 *   //   2. run editor.commands.setHeading1() etc.
 *   //   3. call dismissMenu() to force-hide immediately
 */
import type { IEditor } from "../extensions/types";
import type { EditorState } from "prosemirror-state";

export interface SlashMenuCallbacks {
  /** Called when the slash menu should become visible. */
  onShow: (rect: DOMRect, query: string, slashFrom: number) => void;
  /** Called when the query text changes while menu is visible. */
  onUpdate: (rect: DOMRect, query: string, slashFrom: number) => void;
  /** Called when the menu should hide. */
  onHide: () => void;
}

export interface SlashMenuOptions extends SlashMenuCallbacks {}

export interface SlashMenuController {
  /** Stop listening and hide the menu. */
  cleanup: () => void;
  /** Force-hide the menu immediately (e.g. after selecting an item). */
  dismissMenu: () => void;
}

export function createSlashMenu(
  editor: IEditor,
  options: SlashMenuOptions,
): SlashMenuController {
  const { onShow, onUpdate, onHide } = options;

  let visible = false;
  let rafId: number | null = null;

  function update() {
    const state = editor.getState();
    const info = getSlashInfo(state);

    if (!info) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    // Use cursor position for the rect (same as FloatingMenu).
    const cursorPos = state.selection.from;
    const rect = editor.getViewportRect(cursorPos, cursorPos);
    if (!rect) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    if (visible) {
      onUpdate(rect, info.query, info.slashFrom);
    } else {
      visible = true;
      onShow(rect, info.query, info.slashFrom);
    }
  }

  function dismissMenu() {
    if (visible) { visible = false; onHide(); }
  }

  const unsubscribe = editor.on("update", () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { rafId = null; update(); });
  });

  function cleanup() {
    unsubscribe();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    dismissMenu();
  }

  return { cleanup, dismissMenu };
}

interface SlashInfo {
  query: string;
  slashFrom: number;
}

function getSlashInfo(state: EditorState): SlashInfo | null {
  const { selection } = state;
  const { empty, $anchor } = selection;

  // Need a collapsed cursor in a text block
  if (!empty || !$anchor.parent.isTextblock) return null;

  const blockStart = $anchor.start();
  const cursorPos  = $anchor.pos;

  // Text from the block's content start to the cursor
  const textBeforeCursor = state.doc.textBetween(blockStart, cursorPos);

  // Trigger when cursor is immediately after "/" or "/query".
  // "/" must be at the very start of the block OR preceded by whitespace
  // (Notion-style: works anywhere in a paragraph, not just empty blocks).
  const match = /(^|\s)(\/\S*)$/.exec(textBeforeCursor);
  if (!match) return null;

  const query    = match[2]!.slice(1); // everything after "/"
  const slashFrom = blockStart + match.index + match[1]!.length;

  return { query, slashFrom };
}
