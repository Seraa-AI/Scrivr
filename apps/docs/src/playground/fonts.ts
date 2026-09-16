/**
 * The playground's typefaces.
 *
 * Scrivr ships the engine and never the fonts: an editor is told which faces
 * it may use, and every lane — canvas measurement, PDF embedding — works from
 * that one inventory. This file is the shape an application is expected to
 * copy.
 *
 * The bytes are a real dependency rather than a family name, because a name is
 * a request the browser answers differently on every machine, and a PDF cannot
 * embed a request.
 *
 * These are `inter-ui`'s unsubsetted files rather than the per-script subsets
 * `@fontsource` publishes. The web's usual arrangement — one file per script,
 * chosen by `unicode-range` — assumes the browser picks per character, but a
 * face here is one set of bytes that has to serve both measurement and
 * embedding. A Latin-only file makes a document that turns out to contain
 * Cyrillic render in something nobody chose. One file per face, every script
 * in it, costs ~110 KB and removes the question.
 */
import { DefaultFontProvider, type FontResource } from "@scrivr/react";
import regular from "inter-ui/web/Inter-Regular.woff2?url";
import italic from "inter-ui/web/Inter-Italic.woff2?url";
import bold from "inter-ui/web/Inter-Bold.woff2?url";
import boldItalic from "inter-ui/web/Inter-BoldItalic.woff2?url";

/**
 * Fetched on first use, not at module load: a descriptor costs nothing until
 * something resolves to it, and the provider caches the acquisition itself.
 */
const face = (
  id: string,
  url: string,
  weight: number,
  style: "normal" | "italic",
): FontResource => ({
  id,
  family: "Inter",
  weight,
  style,
  format: "woff2",
  // Inter is SIL Open Font License: embedding it in an exported document is
  // permitted, and saying so is what lets the PDF lane use it.
  embedding: { allowed: true, source: "caller" },
  bytes: async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${id}: ${response.status}`);
    return response.arrayBuffer();
  },
});

const inter = {
  regular: face("inter-400", regular, 400, "normal"),
  italic: face("inter-400-italic", italic, 400, "italic"),
  bold: face("inter-700", bold, 700, "normal"),
  boldItalic: face("inter-700-italic", boldItalic, 700, "italic"),
};

/**
 * Which faces this playground owns.
 *
 * All four by default, so the demo shows real typography. Drop entries to see
 * what an application with a thinner inventory gets: with `resources: []` the
 * editor holds one upright regular, and bold and italic text is drawn by
 * thickening and leaning that face rather than in a designed one. Both the
 * canvas and an exported PDF do the same thing, and `editor.fontSubstitutions`
 * reports what was missing.
 *
 * `?fonts=regular-only` does exactly that without editing this file.
 */
const regularOnly =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("fonts") === "regular-only";

/**
 * Unstyled text resolves to `default`. A family this inventory does not hold
 * resolves to the nearest weight and slant of the default's family, so a
 * document set in Aptos keeps its bold headings — and the editor reports the
 * substitution rather than quietly rendering something else.
 */
export const playgroundFonts = new DefaultFontProvider({
  default: inter.regular,
  resources: regularOnly ? [] : [inter.italic, inter.bold, inter.boldItalic],
});
