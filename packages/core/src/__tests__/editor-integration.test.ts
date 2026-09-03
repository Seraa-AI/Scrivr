/**
 * Integration tests — one real mounted `Editor`, driven the way a user drives
 * it, asserting what a user would see.
 *
 * The unit suites check pieces in isolation, which is how a sourced block
 * shipped with a schema, a normalizer, actions, export handlers and 15 passing
 * tests while rendering as a single blank line: nothing exercised the path from
 * document to page. These tests go through the whole stack — extensions →
 * ProseMirror → layout → the DOM events the browser actually fires — so a
 * feature that is individually correct and collectively broken has somewhere to
 * fail.
 *
 * Canvas measurement is the real Skia backend from `vitest.setup.ts`, so line
 * counts and page breaks are the ones production computes.
 */

import { describe, it, expect, afterEach } from "vitest";
import { TextSelection, NodeSelection } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { Editor } from "../Editor";
import { StarterKit } from "../extensions/StarterKit";
import { computeBlockHash } from "../extensions/built-in/SourcedBlock";
import { createMeasurer } from "../test-utils";
import type { LayoutBlock } from "../layout/BlockLayout";

// ── Harness ───────────────────────────────────────────────────────────────────

interface Harness {
  editor: Editor;
  textarea: HTMLTextAreaElement;
  /** Every laid-out block on every page, in reading order. */
  blocks(): LayoutBlock[];
  /** The text of each laid-out line, in reading order — what the page shows. */
  renderedLines(): string[];
  /** Put the cursor at a document position. */
  caretAt(pos: number): void;
  /** Type text through the hidden textarea, as the browser would. */
  type(text: string): void;
  /** Fire a real paste event carrying the given clipboard flavours. */
  paste(data: Record<string, string>): void;
  /** Fire a real copy event and return what the editor wrote to the clipboard. */
  copy(): Record<string, string>;
  /** Position of the first node of the given type. */
  posOf(typeName: string): number;
  nodeAt(pos: number): PmNode;
}

let active: Harness | null = null;

afterEach(() => {
  active?.editor.destroy();
  active = null;
  document.body.innerHTML = "";
});

function mount(
  content?: Record<string, unknown>,
  options: { sourcedBlock?: true } = {},
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = new Editor({
    extensions: [StarterKit.configure(options.sourcedBlock ? { sourcedBlock: true } : {})],
    ...(content ? { content } : {}),
    textMeasurer: createMeasurer(),
  });
  editor.mount(container);

  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("Editor mounted without its input textarea");

  const harness: Harness = {
    editor,
    textarea,

    blocks: () => editor.layout.pages.flatMap((page) => page.blocks),

    renderedLines: () =>
      harness
        .blocks()
        .flatMap((block) =>
          block.lines.map((line) =>
            line.spans.map((span) => ("text" in span ? span.text : "")).join(""),
          ),
        ),

    caretAt: (pos) => {
      const state = editor.getState();
      editor.applyTransaction(
        state.tr.setSelection(TextSelection.create(state.doc, pos)),
      );
    },

    type: (text) => {
      textarea.value = text;
      textarea.dispatchEvent(new Event("input"));
    },

    paste: (data) => {
      const clipboardData = new DataTransfer();
      for (const [type, value] of Object.entries(data)) {
        clipboardData.setData(type, value);
      }
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      textarea.dispatchEvent(event);
    },

    copy: () => {
      const clipboardData = new DataTransfer();
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      textarea.dispatchEvent(event);
      return {
        "text/plain": clipboardData.getData("text/plain"),
        "text/html": clipboardData.getData("text/html"),
      };
    },

    posOf: (typeName) => {
      let found: number | null = null;
      editor.getState().doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.type.name === typeName) {
          found = pos;
          return false;
        }
        return true;
      });
      if (found === null) throw new Error(`No ${typeName} in the document`);
      return found;
    },

    nodeAt: (pos) => {
      const node = editor.getState().doc.nodeAt(pos);
      if (!node) throw new Error(`No node at ${pos}`);
      return node;
    },
  };

  active = harness;
  return harness;
}

const SOURCE_ATTRS = {
  instanceId: "src_indemnity_1",
  kind: "clause",
  resourceId: "cl_indemnity",
  versionId: "v3",
  baseHash: "",
  baseNormalizer: 1,
};

function sourcedBlockDoc(paragraphs: string[], attrs = SOURCE_ATTRS) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Before the clause." }] },
      {
        type: "sourcedBlock",
        attrs,
        content: paragraphs.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      },
      { type: "paragraph", content: [{ type: "text", text: "After the clause." }] },
    ],
  };
}

// ── Sourced blocks ────────────────────────────────────────────────────────────

describe("a sourced block on the page", () => {
  it("shows its content, in order, alongside the rest of the document", () => {
    const h = mount(
      sourcedBlockDoc(["The Supplier shall indemnify the Customer.", "Net 30 days."]),
      { sourcedBlock: true },
    );

    expect(h.renderedLines()).toEqual([
      "Before the clause.",
      "The Supplier shall indemnify the Customer.",
      "Net 30 days.",
      "After the clause.",
    ]);
  });

  it("contributes no line box of its own", () => {
    const h = mount(sourcedBlockDoc(["Only line."]), { sourcedBlock: true });

    // The wrapper is in the document but never reaches the page as a block.
    expect(h.blocks().map((block) => block.blockType)).not.toContain("sourcedBlock");
    expect(h.blocks()).toHaveLength(3);
  });

  it("keeps its content on the page after an edit inside it", () => {
    const h = mount(sourcedBlockDoc(["Indemnity."]), { sourcedBlock: true });

    // Caret inside the clause paragraph, then type.
    const clausePos = h.posOf("sourcedBlock");
    h.caretAt(clausePos + 2);
    h.type("X");

    expect(h.renderedLines()).toContain("XIndemnity.");
  });
});

describe("divergence from the source", () => {
  it("offers no way to discard edits until there are edits to discard", () => {
    const h = mount(sourcedBlockDoc(["Untouched clause."]), { sourcedBlock: true });
    const pos = h.posOf("sourcedBlock");

    // Record the block's own hash as its base, so it starts clean.
    const node = h.nodeAt(pos);
    h.editor.setNodeAttrs(pos, { baseHash: hashOf(node) });

    selectNode(h, pos);
    expect(actionIds(h)).not.toContain("source.reset");
  });

  it("offers to discard local edits once the text no longer matches the source", () => {
    const h = mount(sourcedBlockDoc(["Untouched clause."]), { sourcedBlock: true });
    const pos = h.posOf("sourcedBlock");
    h.editor.setNodeAttrs(pos, { baseHash: hashOf(h.nodeAt(pos)) });

    h.caretAt(pos + 2);
    h.type("Edited: ");

    selectNode(h, h.posOf("sourcedBlock"));
    expect(actionIds(h)).toContain("source.reset");
  });
});

// ── Clipboard ─────────────────────────────────────────────────────────────────

describe("copying and pasting a sourced block", () => {
  it("gives the pasted copy its own identity", () => {
    const h = mount(sourcedBlockDoc(["Indemnity clause."]), { sourcedBlock: true });

    const pos = h.posOf("sourcedBlock");
    // Select the block itself, the way a user grabs a whole clause.
    selectNode(h, pos);
    const clipboard = h.copy();
    expect(clipboard["text/html"]).toContain("data-sourced-block");

    // Paste at the end of the last paragraph — a second instance of the clause.
    h.caretAt(endOfLastTextblock(h));
    h.paste(clipboard);

    const ids: string[] = [];
    h.editor.getState().doc.descendants((node) => {
      if (node.type.name !== "sourcedBlock") return true;
      const id = node.attrs["instanceId"];
      if (typeof id === "string") ids.push(id);
      return false;
    });

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // Same clause, same version — only the instance differs.
    expect(new Set(idsOfAttr(h, "resourceId")).size).toBe(1);
  });
});

describe("pasting ordinary content", () => {
  it("keeps formatting when pasting the editor's own HTML back", () => {
    const h = mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", marks: [{ type: "bold" }], text: "bold" },
          ],
        },
      ],
    });

    selectRange(h, 1, endOfLastTextblock(h));
    const clipboard = h.copy();

    h.caretAt(endOfLastTextblock(h));
    h.paste(clipboard);

    const marks = new Set<string>();
    h.editor.getState().doc.descendants((node) => {
      for (const mark of node.marks) marks.add(mark.type.name);
      return true;
    });
    expect(marks).toContain("bold");
    expect(h.renderedLines().join(" ")).toContain("plain bold");
  });

  it("turns multi-line plain text into separate paragraphs", () => {
    const h = mount();
    h.caretAt(1);
    h.paste({ "text/plain": "First line\nSecond line\nThird line" });

    expect(h.renderedLines()).toEqual(
      expect.arrayContaining(["First line", "Second line", "Third line"]),
    );
  });

  it("turns a Word list into real list items", () => {
    const h = mount();
    h.caretAt(1);
    h.paste({
      "text/html": [
        '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">',
        '<span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>First item</p>',
        '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">',
        '<span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Second item</p>',
      ].join(""),
    });

    const types: string[] = [];
    h.editor.getState().doc.descendants((node) => {
      types.push(node.type.name);
      return true;
    });
    expect(types).toContain("bulletList");
    expect(h.renderedLines()).toEqual(
      expect.arrayContaining(["First item", "Second item"]),
    );
  });
});

// ── Sections ──────────────────────────────────────────────────────────────────

describe("section breaks", () => {
  it("starts the next section on a new page", () => {
    const h = mount({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Section one." }] },
        { type: "sectionBreak", attrs: { settings: { breakType: "nextPage" } } },
        { type: "paragraph", content: [{ type: "text", text: "Section two." }] },
      ],
    });

    const layout = h.editor.layout;
    expect(layout.pages.length).toBeGreaterThan(1);

    const textOf = (pageIndex: number) =>
      layout.pages[pageIndex]!.blocks.map((b) => b.node.textContent).join(" ");
    expect(textOf(0)).toContain("Section one.");
    expect(textOf(1)).toContain("Section two.");
  });

  it("keeps a continuous break on the same page", () => {
    const h = mount({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Section one." }] },
        { type: "sectionBreak", attrs: { settings: { breakType: "continuous" } } },
        { type: "paragraph", content: [{ type: "text", text: "Section two." }] },
      ],
    });

    expect(h.editor.layout.pages).toHaveLength(1);
  });
});

// ── Helpers that need the editor ──────────────────────────────────────────────

function selectNode(h: Harness, pos: number): void {
  const state = h.editor.getState();
  h.editor.applyTransaction(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
}

function selectRange(h: Harness, from: number, to: number): void {
  const state = h.editor.getState();
  h.editor.applyTransaction(
    state.tr.setSelection(
      TextSelection.create(state.doc, Math.max(from, 0), Math.min(to, state.doc.content.size)),
    ),
  );
}

/** End of the last textblock — a position a TextSelection can actually hold. */
function endOfLastTextblock(h: Harness): number {
  let pos = 1;
  h.editor.getState().doc.descendants((node, nodePos) => {
    if (node.isTextblock) pos = nodePos + node.nodeSize - 1;
    return true;
  });
  return pos;
}

function actionIds(h: Harness): string[] {
  return h.editor.getNodeActions().map((action) => action.id);
}

function idsOfAttr(h: Harness, attr: string): string[] {
  const values: string[] = [];
  h.editor.getState().doc.descendants((node) => {
    if (node.type.name !== "sourcedBlock") return true;
    const value = node.attrs[attr];
    if (typeof value === "string") values.push(value);
    return false;
  });
  return values;
}

/** The hash the divergence plugin compares against — the extension's own. */
function hashOf(node: PmNode): string {
  return computeBlockHash(node.content);
}
