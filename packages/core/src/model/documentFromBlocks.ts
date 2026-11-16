/** One block of a plain document: a title at a level, a paragraph, a bold label and its value, or an inline image. */
export type DocumentBlock =
  | { title: string; level: 1 | 2 | 3 }
  | { paragraph: string }
  | { label: string; value: string }
  | { image: string; width: number; height: number };

type Json = Record<string, unknown>;

/** Text, or nothing for none — ProseMirror refuses an empty text node. */
const text = (words: string, bold = false): Json[] => (words === "" ? [] : [{ type: "text", text: words, ...(bold ? { marks: [{ type: "bold" }] } : {}) }]);

/**
 * A plain document's JSON — StarterKit's headings, paragraphs, bold and
 * images — from `blocks`, for a document a program writes rather than a
 * person: a certificate, a report. Blank words make an empty block, never an
 * empty text, so the result always opens.
 */
export function documentFromBlocks(blocks: readonly DocumentBlock[]): Json {
  return {
    type: "doc",
    content: blocks.map((block): Json => {
      if ("title" in block) return { type: "heading", attrs: { level: block.level }, content: text(block.title) };
      if ("image" in block) return { type: "paragraph", content: [{ type: "image", attrs: { src: block.image, width: block.width, height: block.height } }] };
      if ("label" in block) return { type: "paragraph", content: [...text(block.label === "" ? "" : `${block.label}: `, true), ...text(block.value)] };
      return { type: "paragraph", content: text(block.paragraph) };
    }),
  };
}
