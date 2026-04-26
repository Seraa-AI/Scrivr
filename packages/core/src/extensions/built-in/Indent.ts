import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";

/**
 * Indent — per-paragraph block indent and first-line indent.
 *
 * Block indent (Mod-] / Mod-[) shifts the entire paragraph right/left.
 * First-line indent shifts only the first line (book/academic style).
 *
 * Both are stored as numeric attrs on paragraph/heading nodes:
 *   indent     — block indent level (0, 1, 2, …)
 *   textIndent — first-line indent in px (0, 24, 48, …)
 *
 * Layout applies these in PageLayout (block indent → indentLeft) and
 * LineBreaker (first-line indent → reduced first-line width + x offset).
 */

const INDENT_STEP = 24; // px per indent level
const TEXT_INDENT_STEP = 24; // px per first-line indent step
const MAX_INDENT = 8;

function changeIndent(delta: number): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let tr = state.tr;
    let changed = false;

    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isTextblock) return;
      if (!("indent" in node.attrs)) return;
      const current = (node.attrs["indent"] as number) ?? 0;
      const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
      if (next === current) return;
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
      changed = true;
    });

    if (!changed) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

function changeTextIndent(delta: number): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let tr = state.tr;
    let changed = false;

    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isTextblock) return;
      if (!("textIndent" in node.attrs)) return;
      const current = (node.attrs["textIndent"] as number) ?? 0;
      const next = Math.max(0, Math.min(MAX_INDENT * TEXT_INDENT_STEP, current + delta));
      if (next === current) return;
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, textIndent: next });
      changed = true;
    });

    if (!changed) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

export { INDENT_STEP, TEXT_INDENT_STEP, MAX_INDENT };

export const Indent = Extension.create({
  name: "indent",

  addKeymap() {
    return {
      "Mod-]": changeIndent(1),
      "Mod-[": changeIndent(-1),
    };
  },

  addCommands() {
    return {
      increaseIndent: () => changeIndent(1),
      decreaseIndent: () => changeIndent(-1),
      increaseTextIndent: () => changeTextIndent(TEXT_INDENT_STEP),
      decreaseTextIndent: () => changeTextIndent(-TEXT_INDENT_STEP),
      setTextIndent: (value: unknown) => {
        const px = typeof value === "number" ? value : 0;
        return (state, dispatch) => {
          const { $from, $to } = state.selection;
          let tr = state.tr;
          let changed = false;

          state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            if (!node.isTextblock) return;
            if (!("textIndent" in node.attrs)) return;
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, textIndent: px });
            changed = true;
          });

          if (!changed) return false;
          if (dispatch) dispatch(tr);
          return true;
        };
      },
    };
  },

  addToolbarItems() {
    return [
      {
        command: "increaseIndent",
        label: "→",
        title: "Increase indent (⌘])",
        group: "indent",
        isActive: () => false,
      },
      {
        command: "decreaseIndent",
        label: "←",
        title: "Decrease indent (⌘[)",
        group: "indent",
        isActive: () => false,
      },
    ];
  },
});
