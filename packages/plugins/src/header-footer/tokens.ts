/**
 * Inline atom nodes for dynamic header/footer tokens.
 * These only exist in the schema when the HeaderFooter extension is loaded.
 */

import type { NodeSpec } from "prosemirror-model";

export const pageNumberNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {},
  parseDOM: [{ tag: "span[data-page-number]" }],
  toDOM: () => ["span", { "data-page-number": "" }, "#"],
};

export const totalPagesNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {},
  parseDOM: [{ tag: "span[data-total-pages]" }],
  toDOM: () => ["span", { "data-total-pages": "" }, "#"],
};

export const dateNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    format: { default: "locale" },
    /** Frozen ISO string — when set, used instead of "now". Default is frozen (today). */
    frozen: { default: null },
  },
  parseDOM: [{ tag: "span[data-date]" }],
  toDOM: () => ["span", { "data-date": "" }, "DATE"],
};
