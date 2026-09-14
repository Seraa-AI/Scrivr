/**
 * The playground's typefaces.
 *
 * Scrivr ships the engine and never the fonts: an editor is told which faces
 * it may use, and every lane — canvas measurement, PDF embedding — works from
 * that one inventory. This file is the shape an application is expected to
 * copy.
 *
 * The bytes are a real dependency (`@fontsource/inter`) rather than a family
 * name, because a name is a request the browser answers differently on every
 * machine, and a PDF cannot embed a request.
 */
import { DefaultFontProvider, type FontResource } from "@scrivr/react";
import regular from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import italic from "@fontsource/inter/files/inter-latin-400-italic.woff2?url";
import bold from "@fontsource/inter/files/inter-latin-700-normal.woff2?url";
import boldItalic from "@fontsource/inter/files/inter-latin-700-italic.woff2?url";

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
 * Unstyled text resolves to `default`. Anything a document names that is not
 * in `resources` resolves to it too, and the editor reports the substitution
 * rather than quietly rendering something else.
 */
export const playgroundFonts = new DefaultFontProvider({
  default: inter.regular,
  resources: [inter.italic, inter.bold, inter.boldItalic],
});
