import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import { xml, type DocxNodeHandler } from "../../exports/docx";

function insertPageBreak(): Command {
  return (state, dispatch) => {
    const pageBreak = state.schema.nodes["pageBreak"];
    if (!pageBreak) return false;

    const { $head } = state.selection;
    const after = $head.after(1);
    if (dispatch) {
      const tr = state.tr.insert(after, pageBreak.create()).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

export const PageBreak = Extension.create({
  name: "pageBreak",

  addNodes() {
    return {
      pageBreak: {
        group: "block",
        atom: true,
        selectable: false,
        parseDOM: [{ tag: "div.scrivr-page-break" }],
        toDOM() {
          return ["div", { class: "scrivr-page-break" }];
        },
      },
    };
  },

  addCommands() {
    return {
      insertPageBreak: () => insertPageBreak(),
    };
  },

  addKeymap() {
    return {
      "Mod-Enter": insertPageBreak(),
    };
  },

  addExports() {
    const handler: DocxNodeHandler = () =>
      xml("w:p", undefined, [
        xml("w:r", undefined, [xml("w:br", { "w:type": "page" })]),
      ]);
    return { docx: { nodes: { pageBreak: handler } } };
  },

  addToolbarItems() {
    return [
      {
        command: "insertPageBreak",
        label: "↵",
        title: "Page break (⌘⏎)",
        group: "insert",
        isActive: () => false,
      },
    ];
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Insert a page break after the current top-level block. */
      insertPageBreak: () => ReturnType;
    };
  }
}
