import { Extension } from "@scrivr/core";

/**
 * Initial document loaded in the playground.
 * Showcases the full range of Scrivr formatting capabilities.
 * Extend this as new features land.
 */
const DEMO_DOC = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, align: "left" },
      content: [{ type: "text", text: "Welcome to Scrivr" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "A canvas-rendered document editor built for high-fidelity, multi-page documents. Unlike DOM-based editors, Scrivr paints each page directly onto an HTML ",
        },
        { type: "text", marks: [{ type: "bold" }], text: "canvas element" },
        {
          type: "text",
          text: " — giving you pixel-perfect pagination and PDF export that are identical down to the pixel.",
        },
      ],
    },

    // ── Typography ────────────────────────────────────────────────────────────
    {
      type: "heading",
      attrs: { level: 2, align: "left" },
      content: [{ type: "text", text: "Typography" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        { type: "text", text: "Scrivr supports rich inline formatting — " },
        { type: "text", marks: [{ type: "bold" }], text: "bold" },
        { type: "text", text: ", " },
        { type: "text", marks: [{ type: "italic" }], text: "italic" },
        { type: "text", text: ", " },
        { type: "text", marks: [{ type: "underline" }], text: "underline" },
        { type: "text", text: ", " },
        {
          type: "text",
          marks: [{ type: "strikethrough" }],
          text: "strikethrough",
        },
        { type: "text", text: ", and combinations of all four — like " },
        {
          type: "text",
          marks: [{ type: "bold" }, { type: "italic" }],
          text: "bold italic",
        },
        { type: "text", text: " or " },
        {
          type: "text",
          marks: [{ type: "bold" }, { type: "underline" }],
          text: "bold underline",
        },
        { type: "text", text: "." },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        { type: "text", text: "Font sizes: " },
        {
          type: "text",
          marks: [{ type: "font_size", attrs: { size: 10 } }],
          text: "small (10pt)",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "font_size", attrs: { size: 14 } }],
          text: "medium (14pt)",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "font_size", attrs: { size: 20 } }],
          text: "large (20pt)",
        },
        { type: "text", text: ". Font families: " },
        {
          type: "text",
          marks: [{ type: "font_family", attrs: { family: "Georgia" } }],
          text: "Georgia serif",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "font_family", attrs: { family: "Arial" } }],
          text: "Arial sans-serif",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "font_family", attrs: { family: "Courier New" } }],
          text: "Courier New mono",
        },
        { type: "text", text: "." },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        { type: "text", text: "Apply " },
        {
          type: "text",
          marks: [{ type: "color", attrs: { color: "#2563eb" } }],
          text: "custom colors",
        },
        { type: "text", text: " to any selection, or add " },
        {
          type: "text",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://github.com/Seraa-AI/Scrivr",
                title: null,
              },
            },
          ],
          text: "hyperlinks",
        },
        { type: "text", text: " anywhere in the document." },
      ],
    },

    // ── Alignment ─────────────────────────────────────────────────────────────
    {
      type: "heading",
      attrs: { level: 2, align: "left" },
      content: [{ type: "text", text: "Text Alignment" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "Left-aligned paragraphs are the default for most document content.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "center" },
      content: [
        {
          type: "text",
          text: "Centered text works well for titles, callouts, and signatures.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "right" },
      content: [
        {
          type: "text",
          text: "Right-aligned text for dates, captions, and attribution.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "justify" },
      content: [
        {
          type: "text",
          text: "Justified text distributes word spacing evenly across the line, giving a clean, book-like appearance to longer paragraphs — the kind you would find in a legal contract, academic paper, or formal report. The layout engine handles this natively without CSS.",
        },
      ],
    },

    // ── Lists ─────────────────────────────────────────────────────────────────
    {
      type: "heading",
      attrs: { level: 2, align: "left" },
      content: [{ type: "text", text: "Lists" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { align: "left" },
              content: [
                {
                  type: "text",
                  text: "Canvas renders each page independently — no browser reflow",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { align: "left" },
              content: [
                {
                  type: "text",
                  text: "ProseMirror manages the document model, history, and schema",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { align: "left" },
              content: [
                {
                  type: "text",
                  text: "Layout engine computes exact line breaks and page boundaries",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { order: 1 },
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { align: "left" },
              content: [{ type: "text", text: "Write your document" }],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { align: "left" },
              content: [
                { type: "text", text: "Scrivr paginates automatically" },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { align: "left" },
              content: [
                {
                  type: "text",
                  text: "Export to PDF with a single command",
                },
              ],
            },
          ],
        },
      ],
    },

    // ── Layout engine ─────────────────────────────────────────────────────────
    {
      type: "heading",
      attrs: { level: 2, align: "left" },
      content: [{ type: "text", text: "Layout Engine" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "Scrivr uses a custom layout pipeline that computes line breaks, page boundaries, and float positions — independent of the browser's CSS engine. The output is ",
        },
        {
          type: "text",
          marks: [{ type: "bold" }],
          text: "identical",
        },
        {
          type: "text",
          text: " between the canvas view and PDF export.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "The pipeline runs incrementally during idle time, keeping the editor ",
        },
        {
          type: "text",
          marks: [{ type: "bold" }, { type: "italic" }],
          text: "responsive even on 100+ page documents",
        },
        { type: "text", text: "." },
      ],
    },
  ],
};

/**
 * DemoContent — seeds the editor with the playground demo document.
 * Drop this extension to start with an empty document instead.
 */
export const DemoContent = Extension.create({
  name: "demoContent",
  addInitialDoc() {
    return this.schema.nodeFromJSON(DEMO_DOC);
  },
});
