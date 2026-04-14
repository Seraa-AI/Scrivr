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
      // ── Basic arrow navigation ──────────────────────────────────────────
      ArrowLeft:  (nav, e) => { nav.moveLeft(e.shiftKey);  return true; },
      ArrowRight: (nav, e) => { nav.moveRight(e.shiftKey); return true; },
      ArrowUp:    (nav, e) => { nav.moveUp(e.shiftKey);    return true; },
      ArrowDown:  (nav, e) => { nav.moveDown(e.shiftKey);  return true; },

      // ── Word navigation (Option+Arrow on Mac, Ctrl+Arrow on Win/Linux) ─
      "Alt-ArrowLeft":        (nav) => { nav.moveWordLeft();       return true; },
      "Alt-ArrowRight":       (nav) => { nav.moveWordRight();      return true; },
      "Alt-Shift-ArrowLeft":  (nav) => { nav.moveWordLeft(true);   return true; },
      "Alt-Shift-ArrowRight": (nav) => { nav.moveWordRight(true);  return true; },

      // ── Line start/end (Cmd+Arrow on Mac; Home/End everywhere) ─────────
      "Mod-ArrowLeft":        (nav) => { nav.moveToLineStart();       return true; },
      "Mod-ArrowRight":       (nav) => { nav.moveToLineEnd();         return true; },
      "Mod-Shift-ArrowLeft":  (nav) => { nav.moveToLineStart(true);   return true; },
      "Mod-Shift-ArrowRight": (nav) => { nav.moveToLineEnd(true);     return true; },
      Home:                   (nav) => { nav.moveToLineStart();       return true; },
      End:                    (nav) => { nav.moveToLineEnd();         return true; },
      "Shift-Home":           (nav) => { nav.moveToLineStart(true);   return true; },
      "Shift-End":            (nav) => { nav.moveToLineEnd(true);     return true; },

      // ── Document start/end (Cmd+Up/Down on Mac; Ctrl+Home/End on Win) ──
      "Mod-ArrowUp":          (nav) => { nav.moveToDocStart();       return true; },
      "Mod-ArrowDown":        (nav) => { nav.moveToDocEnd();         return true; },
      "Mod-Shift-ArrowUp":    (nav) => { nav.moveToDocStart(true);   return true; },
      "Mod-Shift-ArrowDown":  (nav) => { nav.moveToDocEnd(true);     return true; },
      "Mod-Home":             (nav) => { nav.moveToDocStart();       return true; },
      "Mod-End":              (nav) => { nav.moveToDocEnd();         return true; },
      "Mod-Shift-Home":       (nav) => { nav.moveToDocStart(true);   return true; },
      "Mod-Shift-End":        (nav) => { nav.moveToDocEnd(true);     return true; },

      // ── Word delete (Option+Backspace/Delete on Mac; Ctrl+Backspace/Delete on Win) ─
      "Alt-Backspace":        (nav) => { nav.deleteWordBackward(); return true; },
      "Alt-Delete":           (nav) => { nav.deleteWordForward();  return true; },
    };
  },
});
