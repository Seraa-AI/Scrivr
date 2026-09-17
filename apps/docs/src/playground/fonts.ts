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
import interRegular from "inter-ui/web/Inter-Regular.woff2?url";
import interItalic from "inter-ui/web/Inter-Italic.woff2?url";
import interBold from "inter-ui/web/Inter-Bold.woff2?url";
import interBoldItalic from "inter-ui/web/Inter-BoldItalic.woff2?url";
import serifRegular from "@expo-google-fonts/source-serif-4/400Regular/SourceSerif4_400Regular.ttf?url";
import serifItalic from "@expo-google-fonts/source-serif-4/400Regular_Italic/SourceSerif4_400Regular_Italic.ttf?url";
import serifBold from "@expo-google-fonts/source-serif-4/700Bold/SourceSerif4_700Bold.ttf?url";
import monoRegular from "@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf?url";

/**
 * Fetched on first use, not at module load: a descriptor costs nothing until
 * something resolves to it, and the provider caches the acquisition itself.
 */
const face = (
  family: string,
  url: string,
  weight: number,
  style: "normal" | "italic",
  format: FontResource["format"],
): FontResource => ({
  id: `${family}-${weight}-${style}`,
  family,
  weight,
  style,
  format,
  // All three families are SIL Open Font License: embedding them in an
  // exported document is permitted, and saying so is what lets the PDF lane
  // use them.
  embedding: { allowed: true, source: "caller" },
  bytes: async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load ${family} ${weight}: ${response.status}`);
    }
    return response.arrayBuffer();
  },
});

const inter = {
  regular: face("Inter", interRegular, 400, "normal", "woff2"),
  italic: face("Inter", interItalic, 400, "italic", "woff2"),
  bold: face("Inter", interBold, 700, "normal", "woff2"),
  boldItalic: face("Inter", interBoldItalic, 700, "italic", "woff2"),
};

/**
 * Three families with deliberately different inventories, because the three
 * states a font control can be in are what an application has to handle.
 *
 * Inter is complete. Source Serif has no bold italic, so a run that is both
 * keeps the designed italic and has its weight thickened — resolution prefers
 * the real slant over the real weight. JetBrains Mono is a code face with only
 * its regular, so bold and italic are both drawn from it. The control says
 * which is which before a heading is set in the wrong one.
 */
const sourceSerif = [
  face("Source Serif 4", serifRegular, 400, "normal", "ttf"),
  face("Source Serif 4", serifItalic, 400, "italic", "ttf"),
  face("Source Serif 4", serifBold, 700, "normal", "ttf"),
];

const jetBrainsMono = [face("JetBrains Mono", monoRegular, 400, "normal", "ttf")];

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
  resources: regularOnly
    ? []
    : [inter.italic, inter.bold, inter.boldItalic, ...sourceSerif, ...jetBrainsMono],
  // Families this machine may well have and nobody here owns. They draw on
  // screen and an export cannot carry them, which is the third state the
  // control has to show — and the one a user is most likely to trip over.
  systemCandidates: regularOnly ? [] : ["Georgia", "Courier New"],
});
