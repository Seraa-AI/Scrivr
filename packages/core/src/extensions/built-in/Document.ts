import { Extension } from "../Extension";

/**
 * Document — contributes the top-level `doc` and `hardBreak` nodes.
 *
 * Every editor needs this. StarterKit includes it automatically.
 * `doc` and `text` are always added by ExtensionManager as a baseline,
 * but hardBreak must be registered explicitly.
 */
export const Document = Extension.create({
  name: "document",

  addNodes() {
    return {
      hardBreak: {
        group: "inline",
        inline: true,
        selectable: false,
        parseDOM: [{ tag: "br" }],
        toDOM: () => ["br"],
      },
    };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        text(state, node) {
          state.text(node.text!);
        },
        hardBreak(state, node, parent, index) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              state.write("\\\n");
              return;
            }
          }
        },
      },
    };
  },
});
