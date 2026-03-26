import { DOMParser as PMDOMParser, Fragment, Mark, Slice } from "prosemirror-model";
import type { Schema, Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { MarkdownParser } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import type { MarkdownBlockRule, MarkdownParserTokenSpec } from "../extensions/types";
import { insertText } from "../model/commands";

// ── Markdown detection heuristic ──────────────────────────────────────────────
// Require intentional block-level structure — mid-sentence asterisks are NOT markdown.
const MARKDOWN_PATTERN = /^(#{1,6} |[*-] |\d+\. |`{3}|---)/m;

// Tokens that markdown-it emits but our schema has no equivalent for.
// These are self-closing inline tokens — { ignore: true } silently skips them.
const IGNORE_TOKENS: Record<string, MarkdownParserTokenSpec> = {
  hardbreak: { ignore: true },
  code_inline: { ignore: true },
  image: { ignore: true },
};

/**
 * PasteTransformer — converts clipboard content into a ProseMirror Transaction.
 *
 * Priority:
 *   1. text/html  → ProseMirror DOMParser (handles bold, headings, lists, etc.)
 *   2. text/plain → prosemirror-markdown MarkdownParser (full CommonMark support)
 *   3. text/plain → legacy line-by-line parser (fallback for unsupported constructs)
 *   4. text/plain → plain text insertion
 */
export class PasteTransformer {
  private readonly md: InstanceType<typeof MarkdownIt>;

  constructor(
    private readonly schema: Schema,
    private readonly extraMarkdownRules: MarkdownBlockRule[] = [],
    private readonly markdownParserTokens: Record<string, MarkdownParserTokenSpec> = {},
  ) {
    // Disable rules that generate tokens our schema can't handle (blockquote, link, image).
    // Their content still renders as plain text — no data loss, just no special formatting.
    this.md = new MarkdownIt({ html: false });
    this.md.disable(["blockquote", "image", "link"]);
  }

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
    cleanPastedHtml(div);

    // Use parse() (not parseSlice) so we get a complete document, then build
    // a Slice with openStart:0. parseSlice sets openStart:1 for block-level
    // content which causes replaceSelection to merge the first block into the
    // cursor paragraph — discarding that block's attrs (e.g. align:"center").
    const doc = PMDOMParser.fromSchema(this.schema).parse(div, {
      preserveWhitespace: false,
    });

    // Collect only block-level nodes. parse() may produce inline nodes (e.g.
    // hard_break) at the document level from Google Docs' trailing <br> tags.
    const blockNodes: Node[] = [];
    doc.content.forEach((n) => { if (n.isBlock) blockNodes.push(n); });
    const fragment = Fragment.from(blockNodes.length ? blockNodes : doc.content);

    // When pasting into an empty paragraph, replace the whole paragraph so we
    // don't leave a stray empty paragraph before the inserted blocks.
    const { $from } = state.selection;
    if ($from.depth >= 1 && $from.parent.content.size === 0) {
      const blockFrom = $from.before($from.depth);
      const blockTo   = $from.after($from.depth);
      return state.tr.replaceWith(blockFrom, blockTo, fragment);
    }

    // Non-empty position: insert complete blocks (openStart:0) so every
    // pasted block retains its own attrs rather than merging with the cursor's.
    return state.tr.replaceSelection(new Slice(fragment, 0, 0));
  }

  // ── Markdown ──────────────────────────────────────────────────────────────

  private looksLikeMarkdown(text: string): boolean {
    if (MARKDOWN_PATTERN.test(text)) return true;
    for (const line of text.split("\n")) {
      const trimmed = line.trimEnd();
      for (const rule of this.extraMarkdownRules) {
        if (rule.pattern.test(trimmed)) return true;
      }
    }
    return false;
  }

  private fromMarkdown(text: string, state: EditorState): Transaction | null {
    // Try prosemirror-markdown's full parser when we have token handlers
    if (Object.keys(this.markdownParserTokens).length > 0) {
      try {
        const tokens = { ...IGNORE_TOKENS, ...this.markdownParserTokens };
        const parser = new MarkdownParser(this.schema, this.md, tokens);
        const doc = parser.parse(text);
        if (doc) {
          return state.tr.replaceSelection(new Slice(doc.content, 0, 0));
        }
      } catch {
        // Unknown token or schema mismatch — fall through to legacy parser
      }
    }

    // Legacy line-by-line parser (handles extension addMarkdownRules + built-in patterns)
    const nodes = this.parseMarkdownBlocks(text);
    if (nodes.length === 0) return insertText(state, text);
    return state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0));
  }

  // ── Legacy line-by-line parser ────────────────────────────────────────────

  /**
   * Line-by-line block parser. Produces paragraph, heading, bulletList,
   * and orderedList nodes. Inline marks (bold, italic) are handled within
   * paragraph and heading text content.
   *
   * Kept as a fallback for when the MarkdownParser encounters tokens our
   * schema doesn't support (blockquotes, nested structures, etc.).
   */
  private parseMarkdownBlocks(text: string): Node[] {
    const lines = text.split("\n");
    const nodes: Node[] = [];

    let paraLines: string[] = [];

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

      // ATX heading
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
          nodes.push(this.makeParagraph(content));
        }
        continue;
      }

      // Bullet list item
      const bulletMatch = /^[*-] (.+)/.exec(line);
      if (bulletMatch) {
        flushPara();
        if (list && list.type !== "bullet") flushList();
        if (!list) list = { type: "bullet", items: [] };
        list.items.push(bulletMatch[1]!);
        continue;
      }

      // Ordered list item
      const orderedMatch = /^\d+\. (.+)/.exec(line);
      if (orderedMatch) {
        flushPara();
        if (list && list.type !== "ordered") flushList();
        if (!list) list = { type: "ordered", items: [] };
        list.items.push(orderedMatch[1]!);
        continue;
      }

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
   */
  private parseInline(text: string): Node[] {
    const nodes: Node[] = [];
    const tokens = text.split(/(\*\*|__|[*_])/);
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

    return nodes.length > 0 ? nodes : [this.schema.text("\u200B")];
  }
}

// ── HTML cleanup ──────────────────────────────────────────────────────────────

/**
 * Normalise pasted HTML before handing it to the ProseMirror DOMParser.
 *
 * Handles:
 *  - Google Docs: unwraps the outer `<b id="docs-internal-guid-…">` shell
 *    (font-weight:normal wrapper that carries no semantic weight)
 *  - Non-breaking spaces (\u00A0) → regular spaces so word-joining works
 */
export function cleanPastedHtml(root: HTMLElement): void {
  // Strip non-content elements — Google Docs includes a <style> block with
  // generated CSS classes (.c0 { font-size:11pt; … }) that don't map to our schema.
  root.querySelectorAll("style, meta, link").forEach((el) => el.remove());

  // Unwrap Google Docs' outer bold wrapper — <b id="docs-internal-guid-…"
  // style="font-weight:normal"> has no semantic meaning; it's just a container.
  root.querySelectorAll('b[id^="docs-internal-guid"]').forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes));
  });

  // Strip empty paragraphs immediately adjacent to <hr> elements.
  // Google Docs wraps every <hr> with <p><span></span></p> spacers — after
  // pasting these become editable empty paragraphs cluttering the document.
  root.querySelectorAll("hr").forEach((hr) => {
    const prev = hr.previousElementSibling;
    const next = hr.nextElementSibling;
    if (prev?.tagName === "P" && (prev.textContent ?? "").trim() === "") prev.remove();
    if (next?.tagName === "P" && (next.textContent ?? "").trim() === "") next.remove();
  });

  // Strip CSS properties that are always default/noise — they create spurious
  // marks (color, font_size, etc.) that pollute the parsed document.
  root.querySelectorAll("[style]").forEach((el) => {
    const s = (el as HTMLElement).style;
    s.removeProperty("background-color");
    s.removeProperty("font-variant");
    s.removeProperty("white-space");          // pre/pre-wrap from Google Docs
    if (s.textDecoration === "none")  s.removeProperty("text-decoration");
    if (s.verticalAlign  === "baseline") s.removeProperty("vertical-align");
    if (s.color === "rgb(0, 0, 0)" || s.color === "#000000") s.removeProperty("color");
    // margin/padding/line-height have no schema equivalent
    // TODO: add these to the schema
    s.removeProperty("line-height");
    s.removeProperty("margin-top");
    s.removeProperty("margin-bottom");
    s.removeProperty("margin-left");
    s.removeProperty("margin-right");
  });

  // Replace non-breaking spaces with regular spaces in all text nodes.
  // Google Docs uses \u00A0 between words which causes word-joining to break.
  const walkTextNodes = (node: ChildNode): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      node.textContent = (node.textContent ?? "").replace(/\u00a0/g, " ");
    } else {
      node.childNodes.forEach(walkTextNodes);
    }
  };
  walkTextNodes(root);
}
