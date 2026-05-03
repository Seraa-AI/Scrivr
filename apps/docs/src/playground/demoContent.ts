import { Extension } from "@scrivr/core";

/**
 * Initial document loaded in the playground.
 * Showcases the full range of Scrivr formatting capabilities
 * including headers and footers with inline images.
 */
const DEMO_DOC = {
  type: "doc",
  attrs: {
    headerFooter: {
      enabled: true,
      differentFirstPage: true,
      differentOddEven: false,
      firstPageHeader: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { align: "center" },
              content: [
                {
                  type: "text",
                  marks: [
                    { type: "bold" },
                    { type: "fontSize", attrs: { size: 20 } },
                  ],
                  text: "Scrivr",
                },
              ],
            },
            {
              type: "paragraph",
              attrs: { align: "center" },
              content: [
                {
                  type: "text",
                  marks: [{ type: "color", attrs: { color: "#6b7280" } }],
                  text: "Canvas Document Editor — Playground Demo",
                },
              ],
            },
          ],
        },
        margin: 32,
      },
      firstPageFooter: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { align: "center" },
              content: [
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: "Draft — For Internal Review Only",
                },
              ],
            },
          ],
        },
        margin: 24,
      },
      defaultHeader: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { align: "left" },
              content: [
                {
                  type: "image",
                  attrs: {
                    src: "https://picsum.photos/200",
                    alt: "Logo",
                    width: 180,
                    height: 93,
                    verticalAlign: "baseline",
                    wrappingMode: "inline",
                  },
                },
                { type: "text", text: "  " },
                {
                  type: "text",
                  marks: [
                    { type: "bold" },
                    { type: "fontSize", attrs: { size: 16 } },
                  ],
                  text: "Scrivr",
                },
                {
                  type: "text",
                  marks: [{ type: "color", attrs: { color: "#6b7280" } }],
                  text: "  ·  Canvas Document Editor",
                },
              ],
            },
            {
              type: "paragraph",
              attrs: { align: "right" },
              content: [
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: "Page ",
                },
                { type: "pageNumber" },
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: " of ",
                },
                { type: "totalPages" },
              ],
            },
          ],
        },
        margin: 32,
      },
      defaultFooter: {
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { align: "center" },
              content: [
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: "Page ",
                },
                { type: "pageNumber" },
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: " of ",
                },
                { type: "totalPages" },
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: "  ·  Confidential — Do not distribute",
                },
              ],
            },
          ],
        },
        margin: 24,
      },
    },
  },
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
          text: "A canvas-rendered document editor built for high-fidelity, multi-page documents. Each page is painted directly to an HTML ",
        },
        { type: "text", marks: [{ type: "bold" }], text: "canvas element" },
        {
          type: "text",
          text: ", so the screen view and the PDF export are pixel-identical.",
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
          marks: [{ type: "fontSize", attrs: { size: 10 } }],
          text: "small (10pt)",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "fontSize", attrs: { size: 14 } }],
          text: "medium (14pt)",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "fontSize", attrs: { size: 20 } }],
          text: "large (20pt)",
        },
        { type: "text", text: ". Font families: " },
        {
          type: "text",
          marks: [{ type: "fontFamily", attrs: { family: "Georgia" } }],
          text: "Georgia serif",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "fontFamily", attrs: { family: "Arial" } }],
          text: "Arial sans-serif",
        },
        { type: "text", text: " · " },
        {
          type: "text",
          marks: [{ type: "fontFamily", attrs: { family: "Courier New" } }],
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
          text: "The layout engine runs four passes per document: build the block flow from ProseMirror, apply float exclusion zones, paginate across page boundaries, and build render fragments. Each pass is pure — no DOM, no CSS reflow — so the same layout can be reproduced server-side for ",
        },
        { type: "text", marks: [{ type: "bold" }], text: "PDF export" },
        { type: "text", text: " that matches the screen exactly." },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "The pipeline runs incrementally during idle time, so the editor stays ",
        },
        {
          type: "text",
          marks: [{ type: "bold" }, { type: "italic" }],
          text: "responsive on 100+ page documents",
        },
        { type: "text", text: "." },
      ],
    },

    // ── Floating images ───────────────────────────────────────────────────────
    {
      type: "heading",
      attrs: { level: 2, align: "left" },
      content: [{ type: "text", text: "Floating Images" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "Anchored images live outside the text flow. Drag one to reposition it; surrounding text reflows around it automatically. Five wrap modes match Word's behaviour — ",
        },
        { type: "text", marks: [{ type: "bold" }], text: "inline" },
        { type: "text", text: ", " },
        { type: "text", marks: [{ type: "bold" }], text: "square" },
        { type: "text", text: ", " },
        { type: "text", marks: [{ type: "bold" }], text: "top-and-bottom" },
        { type: "text", text: ", " },
        { type: "text", marks: [{ type: "bold" }], text: "behind text" },
        { type: "text", text: ", and " },
        { type: "text", marks: [{ type: "bold" }], text: "in front of text" },
        { type: "text", text: "." },
      ],
    },

    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Square wrap" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "image",
          attrs: {
            src: "https://picsum.photos/seed/square/220/160",
            alt: "Square-wrap demo",
            width: 220,
            height: 160,
            wrapMode: "square",
            xAlign: "left",
          },
        },
        {
          type: "text",
          text: "Square wrap creates a rectangular exclusion zone at the image's painted position. Every line of text that overlaps the zone reflows around it, line by line. The exclusion follows the image when you drag — including across page boundaries, where the wrap clamps to the float's own page so the next page begins at full width. Margin around the image is independent of the surrounding paragraph spacing, so you can tune breathing room without disrupting the document's vertical rhythm. Try grabbing the image and dropping it on the right side of the column to watch the text reflow in place.",
        },
      ],
    },

    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Top and bottom" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "Top-and-bottom wrap reserves the full content width for the image. The text in this paragraph sits above the figure, exactly as you'd expect from a Word or Pages document — paragraphs flow naturally until they meet the image's top margin, then they stop and resume on the other side.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "image",
          attrs: {
            src: "https://picsum.photos/seed/topbottom/420/130",
            alt: "Top-and-bottom wrap demo",
            width: 420,
            height: 130,
            wrapMode: "top-bottom",
            xAlign: "center",
          },
        },
        {
          type: "text",
          text: "Once the image's bottom margin clears, text resumes at full width — like this paragraph. This is the right choice for diagrams, screenshots, and figures meant to stand alone with surrounding text framing them above and below. Drag the image up or down to see how the body text repositions in response: the top-and-bottom margins move with the float, and any paragraphs caught in between flow above or below as their position shifts.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "Unlike square wrap, no text sits beside the image — the full content width is reserved for the figure regardless of its actual width. This keeps the layout predictable for figures of varying sizes.",
        },
      ],
    },

    { type: "pageBreak" },
    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Behind and in front of text" }],
    },
    {
      type: "paragraph",
      attrs: { align: "justify" },
      content: [
        {
          type: "image",
          attrs: {
            src: "https://picsum.photos/seed/behind/300/180",
            alt: "Behind-text wrap demo",
            width: 300,
            height: 180,
            wrapMode: "behind",
            xAlign: "right",
            yOffset: 40,
          },
        },
        {
          type: "text",
          text: "Behind-text reserves no flow space — text continues at full width and the image paints as a Z-layer beneath it. This is the classic watermark or letterhead pattern: a logo or pale graphic sits behind the body without disrupting the typography. The anchor and yOffset model is identical to square and top-and-bottom, so dragging the image never changes the document structure underneath the text.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "In-front-of-text inverts the Z-order: the image paints over the body text instead of behind it. Same anchor model, opposite layer.",
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { align: "justify" },
      content: [
        {
          type: "image",
          attrs: {
            src: "https://picsum.photos/seed/front/240/160",
            alt: "In-front-of-text wrap demo",
            width: 240,
            height: 160,
            wrapMode: "front",
            xAlign: "left",
            yOffset: 30,
          },
        },
        {
          type: "text",
          text: "In-front-of-text is rarer than behind — used for callouts, stamps, or annotation overlays where the image is meant to cover part of the text on purpose. The text below this paragraph is full-width and unaware of the image's presence; the image simply paints over it at its anchor position. Drag the image and the text underneath stays exactly where it is — only the float moves.",
        },
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
