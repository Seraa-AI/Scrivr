import { MarkdownParser } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import type { Schema, Node } from "prosemirror-model";
import type { MarkdownParserTokenSpec } from "../extensions/types";

/**
 * The markdown reader every markdown path shares. A table cell holds blocks,
 * while markdown writes a cell's text bare, so each cell's text is read as a
 * paragraph.
 */
export function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({ html: false });
  md.core.ruler.push("table_cell_paragraphs", (state) => {
    const tokens = state.tokens;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      if (token?.type !== "inline") continue;
      const opener = tokens[i - 1]?.type;
      if (opener !== "th_open" && opener !== "td_open") continue;
      const open = new state.Token("paragraph_open", "p", 1);
      const close = new state.Token("paragraph_close", "p", -1);
      tokens.splice(i + 1, 0, close);
      tokens.splice(i, 0, open);
    }
  });
  return md;
}

/**
 * Parse a markdown string into a ProseMirror document node.
 *
 * Standalone helper — used by both `BaseEditor.parseMarkdown` (instance method)
 * and the `DefaultContent` extension (no editor instance available at seed time).
 * Callers must pass the merged token map; the schema must include every node
 * and mark referenced by those tokens.
 */
export function parseMarkdownToDoc(
  schema: Schema,
  tokens: Record<string, MarkdownParserTokenSpec>,
  text: string,
): Node {
  const parser = new MarkdownParser(schema, createMarkdownIt(), tokens);
  const doc = parser.parse(text);
  if (!doc) throw new Error("Failed to parse markdown");
  return doc;
}
