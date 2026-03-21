import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";
import type { ToolbarItemSpec } from "../types";

/**
 * Alignment — per-node text alignment for paragraph and heading.
 *
 * Commands:
 *   setAlignLeft     — Mod-Shift-L
 *   setAlignCenter   — Mod-Shift-E
 *   setAlignRight    — Mod-Shift-R
 *   setAlignJustify  — Mod-Shift-J
 *
 * Applies to all text blocks in the selection range. Preserves all other
 * node attrs (e.g. heading level). Silently skips nodes that have no
 * `align` attr (e.g. listItem, bulletList).
 *
 * Note: list items do not currently support alignment. The toolbar buttons
 * will show "left" as active inside lists, which is the correct default.
 */

type Align = "left" | "center" | "right" | "justify";

function setAlign(align: Align): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let tr = state.tr;
    let changed = false;

    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isTextblock) return;
      if (!("align" in node.attrs)) return;
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
      changed = true;
    });

    if (!changed) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

export const Alignment = Extension.create({
  name: "alignment",

  addKeymap() {
    return {
      "Mod-Shift-l": setAlign("left"),
      "Mod-Shift-e": setAlign("center"),
      "Mod-Shift-r": setAlign("right"),
      "Mod-Shift-j": setAlign("justify"),
    };
  },

  addCommands() {
    return {
      setAlignLeft:    () => setAlign("left"),
      setAlignCenter:  () => setAlign("center"),
      setAlignRight:   () => setAlign("right"),
      setAlignJustify: () => setAlign("justify"),
    };
  },

  addToolbarItems(): ToolbarItemSpec[] {
    return [
      {
        command: "setAlignLeft",
        label: "L",
        title: "Align left (⌘⇧L)",
        group: "align",
        isActive: (_m, _t, ba) => ba["align"] === "left" || ba["align"] === undefined,
      },
      {
        command: "setAlignCenter",
        label: "C",
        title: "Align center (⌘⇧E)",
        group: "align",
        isActive: (_m, _t, ba) => ba["align"] === "center",
      },
      {
        command: "setAlignRight",
        label: "R",
        title: "Align right (⌘⇧R)",
        group: "align",
        isActive: (_m, _t, ba) => ba["align"] === "right",
      },
      {
        command: "setAlignJustify",
        label: "J",
        title: "Justify (⌘⇧J)",
        group: "align",
        isActive: (_m, _t, ba) => ba["align"] === "justify",
      },
    ];
  },
});
