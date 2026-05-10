import { MarkdownParser } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import type { Schema, Node } from "prosemirror-model";
import type { MarkdownParserTokenSpec } from "../extensions/types";

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
  const md = new MarkdownIt({ html: false });
  const parser = new MarkdownParser(schema, md, tokens);
  const doc = parser.parse(text);
  if (!doc) throw new Error("Failed to parse markdown");
  return doc;
}
