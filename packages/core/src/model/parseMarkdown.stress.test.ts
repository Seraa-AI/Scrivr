/**
 * Markdown ingestion stress matrix — exercises each markdown feature in
 * isolation through `ServerEditor`. Each case carries a `skipReason`
 * that points at the round in `docs/markdown-support-plan.md` where
 * the gap is scheduled to close. As each round lands, flip the relevant
 * `skipReason` to `undefined` (or remove the field) and the case
 * starts asserting its support.
 *
 * Currently-supported cases assert their support and will go red on
 * regression. Currently-unsupported cases run as `it.skip` so CI stays
 * green; the matrix lives as a living TODO.
 *
 * Run with:
 *   cd packages/core && npx vitest run src/model/parseMarkdown.stress.test.ts
 */
import { describe, it, expect } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";

interface MarkdownCase {
  /** Stable human-readable label, used as the test name */
  label: string;
  /** Minimal markdown snippet exercising the feature */
  md: string;
  /** Node type that should appear somewhere in the parsed doc */
  expectNode?: string;
  /** Mark type that should appear somewhere in the parsed doc */
  expectMark?: string;
  /**
   * Reason this case is currently skipped — points at the round in
   * `docs/markdown-support-plan.md`. Remove the field to start
   * asserting support.
   */
  skipReason?: string;
}

const CASES: MarkdownCase[] = [
  // Block-level — supported today
  { label: "h1",                       md: "# Heading 1",                  expectNode: "heading" },
  { label: "h2",                       md: "## Heading 2",                 expectNode: "heading" },
  { label: "h3",                       md: "### Heading 3",                expectNode: "heading" },
  { label: "h6",                       md: "###### Heading 6",             expectNode: "heading" },
  { label: "paragraph",                md: "Just a paragraph.",            expectNode: "paragraph" },
  { label: "hr",                       md: "---",                          expectNode: "horizontalRule" },
  { label: "fenced code (no lang)",    md: "```\ncode\n```",               expectNode: "codeBlock" },
  { label: "fenced code (typescript)", md: "```typescript\nlet x = 1;\n```", expectNode: "codeBlock" },
  { label: "indented code",            md: "    indented code\n    line 2", expectNode: "codeBlock" },

  // Blockquote — Round 2 (needs new node + extension)
  { label: "blockquote",               md: "> A quoted line",              expectNode: "blockquote", skipReason: "Round 2 — Blockquote extension + schema node" },
  { label: "blockquote nested",        md: "> outer\n>\n> > inner",        expectNode: "blockquote", skipReason: "Round 2 — Blockquote extension + schema node" },

  // Lists — supported today
  { label: "bullet list",              md: "- one\n- two\n- three",        expectNode: "bulletList" },
  { label: "ordered list",             md: "1. one\n2. two",               expectNode: "orderedList" },
  { label: "nested bullet list",       md: "- one\n  - nested\n- two",     expectNode: "bulletList" },
  { label: "mixed nested list",        md: "1. ordered\n   - bullet\n2. next", expectNode: "orderedList" },
  // Task lists parse as listItem (no checkbox node) — lossy-but-functional
  { label: "task list (unchecked)",    md: "- [ ] task",                   expectNode: "listItem" },
  { label: "task list (checked)",      md: "- [x] task",                   expectNode: "listItem" },

  // Inline marks
  { label: "bold (**)",                md: "Hello **bold**.",              expectMark: "bold" },
  { label: "bold (__)",                md: "Hello __bold__.",              expectMark: "bold" },
  { label: "italic (*)",               md: "Hello *italic*.",              expectMark: "italic" },
  { label: "italic (_)",               md: "Hello _italic_.",              expectMark: "italic" },
  { label: "bold + italic (***)",      md: "Hello ***both***.",            expectMark: "italic" },
  { label: "inline code",              md: "Use `code` inline.",           expectMark: "code", skipReason: "Round 1 — new Code mark + code_inline token" },
  { label: "strikethrough (~~)",       md: "Hello ~~strike~~.",            expectMark: "strikethrough", skipReason: "Round 1 — wire s_open/s_close on Strikethrough extension" },
  { label: "underline (no md syntax)", md: "Hello <u>under</u>.",          expectMark: "underline", skipReason: "Round 2 — paste-side `<u>` parseDOM (markdown has no underline syntax)" },
  { label: "link (inline)",            md: "Visit [example](https://example.com).", expectMark: "link", skipReason: "Round 1 — wire link_open/link_close on Link extension" },
  { label: "link (reference)",         md: "See [it][ref].\n\n[ref]: https://ref.example", expectMark: "link", skipReason: "Round 1 — wire link_open/link_close on Link extension" },
  { label: "link (autolink)",          md: "Visit <https://auto.example>.", expectMark: "link", skipReason: "Round 1 — wire link_open/link_close on Link extension" },
  { label: "link (raw URL)",           md: "Visit https://raw.example",     expectMark: "link", skipReason: "Round 1 — enable markdown-it linkify (after Link tokens)" },

  // Images — Round 1
  { label: "image (inline)",           md: "![alt](https://img.example/a.png)", expectNode: "image", skipReason: "Round 1 — wire image token on Image extension" },
  { label: "image (with title)",       md: "![alt](https://img.example/a.png \"title\")", expectNode: "image", skipReason: "Round 1 — wire image token on Image extension" },
  { label: "image (reference)",        md: "![alt][img]\n\n[img]: https://img.example/a.png", expectNode: "image", skipReason: "Round 1 — wire image token on Image extension" },

  // Breaks — supported today
  { label: "hard break (2-space)",     md: "line one  \nline two",         expectNode: "hardBreak" },
  { label: "hard break (backslash)",   md: "line one\\\nline two",         expectNode: "hardBreak" },

  // Tables — Round 2
  { label: "table (simple)",           md: "| a | b |\n|---|---|\n| 1 | 2 |", expectNode: "table", skipReason: "Round 2 — enable markdown-it tables + wire tokens on Table extension" },

  // Out-of-scope for v1
  { label: "footnote ref+def",         md: "See[^1].\n\n[^1]: Footnote.",  expectNode: "footnote", skipReason: "Round 3 — deferred (needs new schema + sidebar UI)" },
  { label: "definition list",          md: "term\n:   definition",         expectNode: "definitionList", skipReason: "Round 3 — deferred" },
  { label: "math inline ($)",          md: "Energy $E = mc^2$ here.",      expectNode: "math", skipReason: "Round 3 — deferred (needs render strategy + serialization)" },
  { label: "math block ($$)",          md: "$$\n\\int x dx\n$$",           expectNode: "mathBlock", skipReason: "Round 3 — deferred (needs render strategy + serialization)" },

  // Raw HTML — markdown-it `html: false` drops these to text. Currently parses;
  // worth a sharper assertion (the tags become text, not rendered HTML).
  { label: "raw HTML block",           md: "<div>raw block</div>",         skipReason: "Behaviour: html:false drops tags to text; needs explicit assertion of that behaviour" },
  { label: "raw HTML inline",          md: "text <span>inline</span> end", skipReason: "Behaviour: html:false drops tags to text; needs explicit assertion of that behaviour" },

  // Escape + entity — supported today
  { label: "escaped chars",            md: "Escaped \\* \\_ \\` chars.",   expectNode: "paragraph" },
  { label: "html entity",              md: "Copyright &copy; 2026",        expectNode: "paragraph" },
];

function walkForNode(json: unknown, type: string): boolean {
  if (typeof json !== "object" || json === null) return false;
  const n = json as { type?: unknown; content?: unknown[] };
  if (n.type === type) return true;
  if (Array.isArray(n.content)) {
    for (const c of n.content) if (walkForNode(c, type)) return true;
  }
  return false;
}

function walkForMark(json: unknown, type: string): boolean {
  if (typeof json !== "object" || json === null) return false;
  const n = json as { marks?: unknown[]; content?: unknown[] };
  if (Array.isArray(n.marks)) {
    for (const m of n.marks) {
      if (typeof m === "object" && m !== null && (m as { type?: unknown }).type === type) {
        return true;
      }
    }
  }
  if (Array.isArray(n.content)) {
    for (const c of n.content) if (walkForMark(c, type)) return true;
  }
  return false;
}

describe("markdown ingestion stress matrix", () => {
  for (const c of CASES) {
    const itFn = c.skipReason ? it.skip : it;
    itFn(`${c.label}`, () => {
      const editor = new ServerEditor({
        extensions: [StarterKit],
        content: c.md,
      });
      const json = editor.getState().doc.toJSON() as Record<string, unknown>;
      if (c.expectNode) {
        expect(walkForNode(json, c.expectNode), `no '${c.expectNode}' node found in parsed doc`).toBe(true);
      }
      if (c.expectMark) {
        expect(walkForMark(json, c.expectMark), `no '${c.expectMark}' mark found in parsed doc`).toBe(true);
      }
    });
  }

  it("coverage summary", () => {
    const total = CASES.length;
    const skipped = CASES.filter((c) => c.skipReason).length;
    const active = total - skipped;
    // eslint-disable-next-line no-console
    console.log(`\nmarkdown stress: ${active}/${total} active (${skipped} skipped, see docs/markdown-support-plan.md)\n`);
    expect(active).toBeGreaterThan(0);
  });
});
