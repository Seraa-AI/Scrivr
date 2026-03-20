import { DOMParser as PMDOMParser, Fragment, Mark, Slice } from "prosemirror-model";
import type { Schema, Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import type { MarkdownBlockRule } from "../extensions/types";
import { insertText } from "../model/commands";

// Matches built-in markdown block-level patterns at the start of a line.
const MARKDOWN_PATTERN = /^(#{1,6} |[*-] |\d+\. )/m;

/**
 * PasteTransformer — converts clipboard content into a ProseMirror Transaction.
 *
 * Priority:
 *   1. text/html  → ProseMirror DOMParser (handles bold, headings, lists, etc.)
 *   2. text/plain → markdown parser (built-in rules + extension-contributed rules)
 *   3. text/plain → plain text insertion (existing behaviour)
 */
export class PasteTransformer {
  constructor(
    private readonly schema: Schema,
    private readonly extraMarkdownRules: MarkdownBlockRule[] = [],
  ) {}

  transform(clipboardData: DataTransfer, state: EditorState): Transaction | null {
    const html = clipboardData.getData("text/html").trim();
    const plain = clipboardData.getData("text/plain");

    if (html) {
      try {
        return this.fromHtml(html, state);
      } catch {
        // Fall through to plain text on any parse failure
      }
    }

    if (plain) {
      if (this.looksLikeMarkdown(plain)) {
        try {
          return this.fromMarkdown(plain, state);
        } catch {
          // Fall through to plain text
        }
      }
      return insertText(state, plain);
    }

    return null;
  }

  // ── HTML ─────────────────────────────────────────────────────────────────

  private fromHtml(html: string, state: EditorState): Transaction {
    const div = document.createElement("div");
    div.innerHTML = html;
    const slice = PMDOMParser.fromSchema(this.schema).parseSlice(div, {
      preserveWhitespace: false,
    });
    return state.tr.replaceSelection(slice);
  }

  // ── Markdown ──────────────────────────────────────────────────────────────

  private looksLikeMarkdown(text: string): boolean {
    if (MARKDOWN_PATTERN.test(text)) return true;
    // Also trigger for any custom extension rule pattern
    for (const line of text.split("\n")) {
      const trimmed = line.trimEnd();
      for (const rule of this.extraMarkdownRules) {
        if (rule.pattern.test(trimmed)) return true;
      }
    }
    return false;
  }

  private fromMarkdown(text: string, state: EditorState): Transaction | null {
    const nodes = this.parseMarkdownBlocks(text);
    if (nodes.length === 0) return insertText(state, text);
    const slice = new Slice(Fragment.from(nodes), 0, 0);
    return state.tr.replaceSelection(slice);
  }

  /**
   * Line-by-line block parser. Produces paragraph, heading, bulletList,
   * and orderedList nodes. Inline marks (bold, italic) are handled within
   * paragraph and heading text content.
   */
  private parseMarkdownBlocks(text: string): Node[] {
    const lines = text.split("\n");
    const nodes: Node[] = [];

    // Accumulator for multi-line paragraphs
    let paraLines: string[] = [];

    // Accumulator for list items
    type ListState = { type: "bullet" | "ordered"; items: string[] };
    let list: ListState | null = null;

    const flushPara = () => {
      if (paraLines.length === 0) return;
      const content = paraLines.join(" ").trim();
      if (content) nodes.push(this.makeParagraph(content));
      paraLines = [];
    };

    const flushList = () => {
      if (!list) return;
      const items = list.items.map((itemText) =>
        this.schema.nodes["listItem"]!.create(
          null,
          this.schema.nodes["paragraph"]!.create(null, this.parseInline(itemText)),
        ),
      );
      const listType = list.type === "bullet" ? "bulletList" : "orderedList";
      const listNode = this.schema.nodes[listType];
      if (listNode && items.length > 0) {
        nodes.push(listNode.create(null, items));
      }
      list = null;
    };

    for (const raw of lines) {
      const line = raw.trimEnd();

      // Blank line — flush accumulators
      if (line.trim() === "") {
        flushPara();
        flushList();
        continue;
      }

      // Extension-contributed rules — tried before built-in handlers
      let customMatched = false;
      for (const rule of this.extraMarkdownRules) {
        const match = rule.pattern.exec(line);
        if (match) {
          const node = rule.createNode(match, this.schema, this.parseInline.bind(this));
          if (node) {
            flushPara();
            flushList();
            nodes.push(node);
            customMatched = true;
            break;
          }
        }
      }
      if (customMatched) continue;

      // ATX heading: # through ######
      const headingMatch = /^(#{1,6}) (.+)/.exec(line);
      if (headingMatch) {
        flushPara();
        flushList();
        const level = headingMatch[1]!.length;
        const content = headingMatch[2]!.trim();
        const headingNode = this.schema.nodes["heading"];
        if (headingNode) {
          nodes.push(headingNode.create({ level }, this.parseInline(content)));
        } else {
          // Schema has no heading — fall back to paragraph
          nodes.push(this.makeParagraph(content));
        }
        continue;
      }

      // Bullet list item: "- " or "* "
      const bulletMatch = /^[*-] (.+)/.exec(line);
      if (bulletMatch) {
        flushPara();
        if (list && list.type !== "bullet") flushList();
        if (!list) list = { type: "bullet", items: [] };
        list.items.push(bulletMatch[1]!);
        continue;
      }

      // Ordered list item: "1. " "2. " etc.
      const orderedMatch = /^\d+\. (.+)/.exec(line);
      if (orderedMatch) {
        flushPara();
        if (list && list.type !== "ordered") flushList();
        if (!list) list = { type: "ordered", items: [] };
        list.items.push(orderedMatch[1]!);
        continue;
      }

      // Regular text — close any open list, accumulate into paragraph
      if (list) flushList();
      paraLines.push(line);
    }

    flushPara();
    flushList();

    return nodes;
  }

  private makeParagraph(text: string): Node {
    return this.schema.nodes["paragraph"]!.create(null, this.parseInline(text));
  }

  /**
   * Inline mark parser — handles **bold**, *italic*, __bold__, _italic_.
   * Returns an array of text nodes with the appropriate marks applied.
   */
  private parseInline(text: string): Node[] {
    const nodes: Node[] = [];
    // Tokenise: split on bold/italic delimiters while preserving them
    const tokens = text.split(/(\*\*|__|\*|_)/);
    const boldMark = this.schema.marks["bold"];
    const italicMark = this.schema.marks["italic"];

    let bold = false;
    let italic = false;

    for (const token of tokens) {
      if (token === "**" || token === "__") {
        if (boldMark) bold = !bold;
        continue;
      }
      if (token === "*" || token === "_") {
        if (italicMark) italic = !italic;
        continue;
      }
      if (!token) continue;

      const marks: Mark[] = [];
      if (bold && boldMark) marks.push(boldMark.create());
      if (italic && italicMark) marks.push(italicMark.create());
      nodes.push(this.schema.text(token, marks));
    }

    // If no nodes produced (e.g. empty string), return a zero-width space
    // so the paragraph node is always valid.
    return nodes.length > 0 ? nodes : [this.schema.text("\u200B")];
  }
}
