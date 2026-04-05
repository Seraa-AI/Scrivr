import { Schema } from "prosemirror-model";

/**
 * The canonical schema for the canvas editor.
 *
 * Nodes define document structure (blocks and inline elements).
 * Marks define character-level formatting.
 *
 * We use prosemirror-model for this because it gives us:
 *   - Validated document trees
 *   - Integer position mapping (essential for CharacterMap ↔ cursor)
 *   - Slice operations (copy/paste)
 *   - JSON serialization out of the box
 *
 * prosemirror-view is never imported. The schema is purely a data contract.
 */

export const schema = new Schema({
  nodes: {
    // ── Top level ────────────────────────────────────────────────────────────

    doc: {
      content: "block+",
    },

    // ── Block nodes ──────────────────────────────────────────────────────────

    paragraph: {
      group: "block",
      content: "inline*",
      attrs: {
        align: { default: "left" }, // left | center | right | justify
      },
    },

    heading: {
      group: "block",
      content: "inline*",
      attrs: {
        level: { default: 1 }, // 1–6
        align: { default: "left" },
      },
      defining: true,
    },

    bulletList: {
      group: "block",
      content: "listItem+",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", 0],
    },

    orderedList: {
      group: "block",
      content: "listItem+",
      attrs: {
        order: { default: 1 }, // starting number
      },
      parseDOM: [{ tag: "ol" }],
      toDOM: () => ["ol", 0],
    },

    listItem: {
      content: "paragraph block*",
      defining: true,
      attrs: {
        nodeId: { default: null },
        dataTracked: { default: [] },
      },
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },

    // Code block — monospace, no marks, input rule ``
    codeBlock: {
      content: "text*",
      group: "block",
      code: true,
      marks: "",
      attrs: {
        nodeId: { default: null },
        dataTracked: { default: [] },
      },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" as const }],
      toDOM: () => ["pre", ["code", 0]],
    },

    // Horizontal rule — leaf block, drawn as a thin line
    horizontalRule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    },

    // Table — fixed-width columns, common in legal contracts
    table: {
      group: "block",
      content: "table_row+",
      attrs: {
        columnWidths: { default: [] as number[] }, // explicit widths in px
      },
    },

    table_row: {
      content: "table_cell+",
    },

    table_cell: {
      content: "block+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        background: { default: null as string | null },
      },
    },

    // Hard page break — forces content onto the next page
    page_break: {
      group: "block",
      isLeaf: true,
    },

    // ── Inline nodes ─────────────────────────────────────────────────────────

    // Inline image — sits inside a paragraph line box
    image: {
      group: "inline",
      inline: true,
      attrs: {
        src: { default: "" },
        alt: { default: "" },
        width: { default: 200 },
        height: { default: 200 },
        nodeId: { default: null },
        verticalAlign: { default: "baseline" },
        wrappingMode: { default: "inline" },
        floatOffset: { default: { x: 0, y: 0 } },
      },
      parseDOM: [{ tag: "img[src]" }],
      toDOM: (node) => [
        "img",
        { src: node.attrs.src as string, alt: node.attrs.alt as string },
      ],
    },

    // Hard line break within a paragraph (Shift+Enter)
    hard_break: {
      group: "inline",
      inline: true,
      isLeaf: true,
      selectable: false,
    },

    text: {
      group: "inline",
    },
  },

  marks: {
    // ── Core formatting ───────────────────────────────────────────────────────

    bold: {},
    italic: {},
    underline: {},
    strikethrough: {},

    // ── Typography ────────────────────────────────────────────────────────────

    font_size: {
      attrs: {
        size: {}, // number, in pt (e.g. 12)
      },
      excludes: "font_size", // only one font size at a time
    },

    font_family: {
      attrs: {
        family: {}, // e.g. "Times New Roman", "Arial"
      },
      excludes: "font_family",
    },

    color: {
      attrs: {
        color: {}, // CSS color string e.g. "#1a1a1a"
      },
      excludes: "color",
    },

    // ── Links ─────────────────────────────────────────────────────────────────

    link: {
      attrs: {
        href: {},
        title: { default: null as string | null },
      },
      inclusive: false, // typing at the end of a link doesn't extend it
    },

    // ── Highlight ─────────────────────────────────────────────────────────────

    highlight: {
      attrs: {
        color: { default: "rgba(255, 220, 0, 0.4)" },
        dataTracked: { default: [] },
      },
    },

    // ── Track changes ─────────────────────────────────────────────────────────
    // These marks are applied by the track-changes plugin.
    // The DOCX exporter maps them to <w:ins> and <w:del> OOXML nodes.

    tracked_insert: {
      attrs: {
        dataTracked: { default: null },
      },
      inclusive: false,
      excludes: "",
      parseDOM: [{ tag: "ins[data-tracked]" }],
      toDOM: () => ["ins", { "data-tracked": "insert" }, 0],
    },

    tracked_delete: {
      attrs: {
        dataTracked: { default: null },
      },
      inclusive: false,
      excludes: "",
      parseDOM: [{ tag: "del[data-tracked]" }],
      toDOM: () => ["del", { "data-tracked": "delete" }, 0],
    },
  },
});

// Convenience string-union type exports for the built-in schema node/mark names.
// Named with "Name" suffix to avoid collision with ProseMirror's NodeType/MarkType classes.
export type NodeTypeName = keyof typeof schema.nodes;
export type MarkTypeName = keyof typeof schema.marks;
