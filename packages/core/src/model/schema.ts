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
        level: { default: 1 },      // 1–6
        align: { default: "left" },
      },
      defining: true,
    },

    bullet_list: {
      group: "block",
      content: "list_item+",
    },

    ordered_list: {
      group: "block",
      content: "list_item+",
      attrs: {
        order: { default: 1 },      // starting number
      },
    },

    list_item: {
      content: "paragraph block*",
      defining: true,
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

    // Form field — embedded interactive element within document flow
    // Rendered as a canvas overlay (text input, checkbox, date picker)
    // Inline so it can sit within a paragraph (e.g. signature line)
    form_field: {
      group: "inline",
      isLeaf: true,
      inline: true,
      attrs: {
        id: { default: "" },
        fieldType: { default: "text" }, // text | checkbox | date | signature
        label: { default: "" },
        placeholder: { default: "" },
        required: { default: false },
        value: { default: null as string | boolean | null },
      },
    },

    // ── Inline nodes ─────────────────────────────────────────────────────────

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

    // ── Track changes ─────────────────────────────────────────────────────────
    // These marks are applied by the track-changes plugin.
    // The DOCX exporter maps them to <w:ins> and <w:del> OOXML nodes.

    track_insert: {
      attrs: {
        author: {},
        date: {},    // ISO 8601 string
      },
    },

    track_delete: {
      attrs: {
        author: {},
        date: {},
      },
    },
  },
});

// Convenience string-union type exports for the built-in schema node/mark names.
// Named with "Name" suffix to avoid collision with ProseMirror's NodeType/MarkType classes.
export type NodeTypeName = keyof typeof schema.nodes;
export type MarkTypeName = keyof typeof schema.marks;
