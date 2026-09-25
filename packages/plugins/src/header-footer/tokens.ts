/**
 * Inline atom nodes for dynamic header/footer tokens.
 * These only exist in the schema when the HeaderFooter extension is loaded.
 *
 * None of them declares a size. Each is claimed by an `InlineStrategy` in
 * tokenStrategies.ts, which measures the text it is about to draw — the digits
 * of a page count, a formatted date — against the font the band is set in. A
 * constant here could only ever be right for one font and one value.
 */

import type { NodeSpec } from "@scrivr/core/pm";

export const pageNumberNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  parseDOM: [{ tag: "span[data-page-number]" }],
  toDOM: () => ["span", { "data-page-number": "" }, "#"],
};

export const totalPagesNode: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
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
