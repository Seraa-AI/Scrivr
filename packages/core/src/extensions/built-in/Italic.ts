import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";

interface ItalicOptions {
  shortcut: boolean;
}

export const Italic = Extension.create<ItalicOptions>({
  name: "italic",

  defaultOptions: {
    shortcut: true,
  },

  addMarks() {
    return {
      italic: {
        parseDOM: [
          { tag: "em" },
          { tag: "i", getAttrs: (node) => (node as HTMLElement).style.fontStyle !== "normal" && null },
          { style: "font-style=italic" },
        ],
        toDOM: () => ["em", 0],
      },
    };
  },

  addKeymap() {
    if (!this.options.shortcut) return {};
    return {
      "Mod-i": toggleMark(this.schema.marks["italic"]!),
    };
  },

  addCommands() {
    return {
      toggleItalic: () => toggleMark(this.schema.marks["italic"]!),
    };
  },
});
