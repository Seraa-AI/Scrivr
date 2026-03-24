import { Extension } from "../Extension";
import { deleteBackward, deleteForward } from "../../model/commands";
import { selectAll } from "prosemirror-commands";

/**
 * BaseEditing — the minimum editing bindings every editor needs.
 *
 * - addKeymap:        Backspace + Delete (document mutations via ProseMirror Command)
 * - addInputHandlers: Arrow keys (editor-level navigation via EditorNavigator)
 *
 * Arrow keys live here rather than hardcoded in Editor so consumers can override
 * them — e.g. swap in vim-style hjkl navigation or RTL arrow behaviour — without
 * touching Editor.ts.
 */
export const BaseEditing = Extension.create({
  name: "baseEditing",

  addKeymap() {
    const { hard_break } = this.schema.nodes;
    return {
      Backspace: deleteBackward,
      Delete: deleteForward,
      "Shift-Enter": (state, dispatch) => {
        if (!hard_break) return false;
        if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
        return true;
      },
      "Mod-a": selectAll,
    };
  },

  addInputHandlers() {
    return {
      ArrowLeft:  (nav, e) => { nav.moveLeft(e.shiftKey);  return true; },
      ArrowRight: (nav, e) => { nav.moveRight(e.shiftKey); return true; },
      ArrowUp:    (nav, e) => { nav.moveUp(e.shiftKey);    return true; },
      ArrowDown:  (nav, e) => { nav.moveDown(e.shiftKey);  return true; },
    };
  },
});
