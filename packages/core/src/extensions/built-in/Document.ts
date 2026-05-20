import { Extension } from "../Extension";

/**
 * Document — root-of-doc extension. Today its only contribution is the
 * baseline `text` markdown serializer rule (every doc has text nodes;
 * `prosemirror-markdown` needs an explicit serializer for them).
 *
 * The `doc` and `text` node specs are seeded by `ExtensionManager` as a
 * baseline so an editor with no extensions still parses. `hardBreak`
 * lives in its own `HardBreak` extension as of the extraction PR.
 *
 * Kept as a separate extension (rather than folded into the baseline)
 * so apps that want a custom doc shape can disable it via
 * `StarterKit.configure({ document: false })` and supply their own.
 */
export const Document = Extension.create({
  name: "document",

  addMarkdownSerializerRules() {
    return {
      nodes: {
        text(state, node) {
          state.text(node.text!);
        },
      },
    };
  },
});
