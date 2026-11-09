import { DefaultContent } from "@scrivr/core";

import { TRACK_CHANGES_DEMO_DOC } from "./trackChangesDemo";

// ── Table builders ────────────────────────────────────────────────────────────
// Compact helpers so the demo table stays readable. Each cell holds one
// left-aligned paragraph; headers are bold on a light fill.

// Translucent neutral so the header shade blends over the page background
// instead of fighting it — subtle gray on the light page, subtle lift on the
// dark page. An opaque light fill would look wrong in dark mode.
const HEADER_FILL = "rgba(148, 163, 184, 0.16)";

function para(text: string, bold = false) {
  return {
    type: "paragraph",
    attrs: { align: "left" as const },
    content: text ? [{ type: "text", ...(bold ? { marks: [{ type: "bold" }] } : {}), text }] : [],
  };
}

function headerCell(text: string) {
  return { type: "tableHeader", attrs: { background: HEADER_FILL }, content: [para(text, true)] };
}

function bodyCell(text: string) {
  return { type: "tableCell", content: [para(text)] };
}

/** Scrivr's four-layer architecture as a 3-column, 5-row table. */
function architectureTable() {
  const rows = [
    ["Layer", "Technology", "Purpose"],
    ["Model", "ProseMirror", "Immutable document tree, schema, and history"],
    ["Layout", "Custom engine", "Pagination, line-breaking, and text measurement"],
    ["Renderer", "HTML5 Canvas", "Pixel-perfect painting of the layout output"],
    ["Input", "Hidden textarea", "Keyboard, IME, and paste into transactions"],
  ];
  return {
    type: "table",
    attrs: { layout: "fixed", grid: [110, 150, 250] },
    content: rows.map((cells, i) => ({
      type: "tableRow",
      ...(i === 0 ? { attrs: { repeatHeader: true } } : {}),
      content: cells.map((text) => (i === 0 ? headerCell(text) : bodyCell(text))),
    })),
  };
}

/** A release schedule, long enough for a float beside it to reach several rows. */
function scheduleTable() {
  const rows = [
    ["Milestone", "Owner", "Status"],
    ["Schema freeze", "Model", "Done"],
    ["Layout pass", "Layout", "In review"],
    ["Canvas paint", "Renderer", "In progress"],
    ["Input bridge", "Input", "Planned"],
    ["PDF export", "Export", "Planned"],
    ["Release notes", "Docs", "Planned"],
  ];
  return {
    type: "table",
    attrs: { layout: "fixed", grid: [170, 150, 190] },
    content: rows.map((cells, i) => ({
      type: "tableRow",
      ...(i === 0 ? { attrs: { repeatHeader: true } } : {}),
      content: cells.map((text) => (i === 0 ? headerCell(text) : bodyCell(text))),
    })),
  };
}

/** A numbered list of one-line steps, one paragraph per item. */
function steps(items: string[]) {
  return {
    type: "orderedList",
    content: items.map((text) => ({ type: "listItem", content: [para(text)] })),
  };
}

// ── List builders ─────────────────────────────────────────────────────────────

type Block = Record<string, unknown>;

/** A list item: its first paragraph, then any further paragraphs or nested lists. */
function item(text: string | Block, ...rest: Block[]) {
  return { type: "listItem", content: [typeof text === "string" ? para(text) : text, ...rest] };
}

function bullets(...items: Block[]) {
  return { type: "bulletList", content: items };
}

function numbered(order: number, ...items: Block[]) {
  return { type: "orderedList", attrs: { order }, content: items };
}

/** A paragraph that anchors a floating image before its text. */
function withImage(image: Record<string, unknown>, text: string) {
  return {
    type: "paragraph",
    attrs: { align: "left" as const },
    content: [{ type: "image", attrs: image }, ...(text ? [{ type: "text", text }] : [])],
  };
}

/** A two-column table whose wide cell holds a numbered list beside an image. */
function listInCellTable() {
  return {
    type: "table",
    attrs: { layout: "fixed", grid: [150, 360] },
    content: [
      {
        type: "tableRow",
        attrs: { repeatHeader: true },
        content: [headerCell("Phase"), headerCell("Checklist")],
      },
      {
        type: "tableRow",
        content: [
          bodyCell("Launch"),
          {
            type: "tableCell",
            content: [
              withImage(
                { src: "https://picsum.photos/seed/listcell/90/90", alt: "Image in a list cell", width: 90, height: 90, wrapMode: "square", xAlign: "right" },
                "Before the release:",
              ),
              numbered(
                1,
                item("Freeze the schema and tag the build"),
                item("Run the layout suite on every supported font", bullets(item("macOS"), item("Linux"))),
                item("Publish the notes"),
              ),
            ],
          },
        ],
      },
      {
        type: "tableRow",
        content: [
          { type: "tableCell", content: [numbered(1000, item("Unbelievably"), item("Long words"))] },
          bodyCell("In a narrow cell no tab stop past 1000. leaves the text room, so, as in Word, the text follows the number after a space."),
        ],
      },
    ],
  };
}

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
                {
                  type: "pageNumber",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                },
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: " of ",
                },
                {
                  type: "totalPages",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                },
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
                {
                  type: "pageNumber",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                },
                {
                  type: "text",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                  text: " of ",
                },
                {
                  type: "totalPages",
                  marks: [
                    { type: "fontSize", attrs: { size: 10 } },
                    { type: "color", attrs: { color: "#9ca3af" } },
                  ],
                },
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
    para("Lists follow Word: each level is indented half an inch, the marker hangs a quarter inch before the text, and bullets and numbers change with depth. Press Tab to nest an item and Shift-Tab to lift it back out."),
    bullets(
      item(
        "Canvas renders each page independently — no browser reflow",
        bullets(
          item(
            "Second level uses a hollow bullet",
            bullets(item("Third level uses a square"), item("and the pattern repeats as you nest deeper")),
          ),
          item("Back on the second level"),
        ),
      ),
      item(
        "An item can hold more than one paragraph",
        para("This second paragraph belongs to the same item. It lines up with the text above and carries no marker of its own, like a continuation paragraph in Word."),
      ),
      item("Layout engine computes exact line breaks and page boundaries"),
    ),
    numbered(
      1,
      item(
        "Write your document",
        numbered(
          1,
          item("Numbers at the second level are letters", numbered(1, item("and roman numerals at the third"), item("counting on from there"))),
          item("Each level counts on its own"),
        ),
      ),
      item("Scrivr paginates automatically", bullets(item("Bullets can sit under a number"), item("and the outer count carries on after them"))),
      item("Export to PDF or Word — the numbers, faces and indents match the screen"),
    ),
    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Wide numbers and marker faces" }],
    },
    para("This list starts at 98. Once the number grows wider than its quarter-inch hang, the first line moves to the next tab stop instead of running into it, as in Word."),
    numbered(
      98,
      item("Ninety-eight fits in the hang"),
      item("Ninety-nine still fits"),
      item("One hundred is wider than the hang, so this line steps to the next tab stop while the lines that wrap below it keep the item's indent, the way Word lays out a hanging indent."),
    ),
    numbered(
      1,
      item({
        type: "paragraph",
        attrs: { align: "left" },
        content: [{ type: "text", marks: [{ type: "bold" }, { type: "fontSize", attrs: { size: 20 } }], text: "A number takes the face of its item's first text" }],
      }),
      item({
        type: "paragraph",
        attrs: { align: "left" },
        content: [{ type: "text", marks: [{ type: "fontFamily", attrs: { family: "Georgia" } }], text: "This number is drawn in Georgia, on canvas and in the PDF" }],
      }),
    ),
    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Lists beside images" }],
    },
    numbered(
      1,
      item(
        withImage(
          { src: "https://picsum.photos/seed/listsquare/150/130", alt: "Square image beside a list", width: 150, height: 130, wrapMode: "square", xAlign: "left" },
          "A square image anchored in a list item pushes the item, number and all, to its right: the number starts at the image's edge and the text at the next tab stop past it, as in Word.",
        ),
      ),
      item("The next items stay beside the image until it ends, each with its number in front of its own text."),
      item(
        withImage(
          { src: "https://picsum.photos/seed/listbreak/420/90", alt: "Top-and-bottom image in a list item", width: 420, height: 90, wrapMode: "top-bottom", xAlign: "center" },
          "This item anchors a top-and-bottom image. Its number sits on the first line of text below the image, not in the gap beside it.",
        ),
      ),
      item(withImage({ src: "https://picsum.photos/seed/listonly/100/70", alt: "Image alone in a list item", width: 100, height: 70, wrapMode: "square", xAlign: "right" }, "")),
      item("The item above holds only a floating image. As in Word, it still keeps one line for its number."),
    ),
    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Lists in tables" }],
    },
    para("A list in a cell is numbered, nested and indented as it is in the body, and wraps around an image in that cell."),
    listInCellTable(),
    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Try it" }],
    },
    steps([
      "Put the caret in a list item and press Tab, then Shift-Tab. The marker changes with depth (•, ◦, ▪ and 1., a., i.).",
      "Change the font or size of an item's first word. Its number follows.",
      "Drag the square image beside the list up or down. The numbers move past it and back, and the text follows them.",
      "Export to PDF and to Word, and open the Word file. Levels, numbers, faces and indents match the screen.",
    ]),

    // ── Tables ──────────────────────────────────────────────────────────────────
    {
      type: "heading",
      attrs: { level: 2, align: "left" },
      content: [{ type: "text", text: "Tables" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "text",
          text: "Tables lay out as a real grid — each cell is its own mini-flow, so text wraps, marks render, and the caret hit-tests inside cells. Columns fit the content width, and the whole grid round-trips through PDF and DOCX export. Here is Scrivr's own four-layer architecture:",
        },
      ],
    },
    architectureTable(),

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

    // ── Floating images beside tables ─────────────────────────────────────────
    { type: "pageBreak" },
    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Images beside tables" }],
    },
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "image",
          attrs: {
            src: "https://picsum.photos/seed/besidetable/200/220",
            alt: "Square image reaching over a table",
            width: 200,
            height: 220,
            wrapMode: "square",
            xAlign: "right",
          },
        },
        {
          type: "text",
          text: "A table never shrinks to sit beside a floating image. As in Word, rows that would run under a square or top-and-bottom image move below it instead, and rows above the image keep their place. This image is anchored here and is taller than this paragraph, so the schedule below starts under it rather than behind it.",
        },
      ],
    },
    scheduleTable(),
    {
      type: "paragraph",
      attrs: { align: "left" },
      content: [
        {
          type: "image",
          attrs: {
            src: "https://picsum.photos/seed/stacked/160/110",
            alt: "Stacked square image",
            width: 160,
            height: 110,
            wrapMode: "square",
            xAlign: "left",
          },
        },
        {
          type: "image",
          attrs: {
            src: "https://picsum.photos/seed/stacked2/160/110",
            alt: "Second stacked square image",
            width: 160,
            height: 110,
            wrapMode: "square",
            xAlign: "left",
          },
        },
        {
          type: "text",
          text: "Two square images on the same side never overlap: as in Word, the second one sits beside the first while the column has room, and below it when it does not. The text wraps around both.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 3, align: "left" },
      content: [{ type: "text", text: "Try it" }],
    },
    steps([
      "Drag the right-hand image down so it ends above the schedule. Rows it would cover move below it; rows above it stay put.",
      "Drop an image onto a cell of the schedule. As in Word, it moves into that cell, the cell's text wraps around it, and the row grows to hold it.",
      "Drag that image to another cell, then back out below the table. It follows the drop each time.",
      "Click an image sitting in a cell. It selects, and you can drag it again.",
      "Switch an image in a cell to ↕ Break, then to Behind or Front. ↕ Break puts the cell's text below it; Behind and Front leave the row as it was.",
      "Make the column narrow, or widen the stacked images, so they no longer fit side by side. The second moves below the first.",
      "Add rows until the table crosses onto the next page. A row carries its image with it.",
      "Export to PDF and to Word. Images in cells, rows and wraps sit where they do on screen.",
      "To check: drop a square image onto the top of a page that begins with a paragraph carried over from the page before. It should land where you drop it.",
    ]),
  ],
};

/**
 * Upper bound on `?pages=`. Generation itself is linear and cheap, but the
 * layout work the fixture then provokes is not, and a mistyped extra zero
 * should not lock up the tab before the editor can paint.
 */
const MAX_PERFORMANCE_PAGES = 5000;

/**
 * Pages requested via `?pages=<n>`, or 0 when the parameter is absent. Zero
 * keeps the playground on the standard fixture, so the long-document path is
 * something you opt into per visit rather than something every visitor loads.
 */
function requestedPageCount(): number {
  if (typeof window === "undefined") return 0;
  const raw = new URLSearchParams(window.location.search).get("pages");
  if (raw === null) return 0;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[playground] ignoring ?pages=${raw} — expected a positive integer`);
    return 0;
  }
  if (parsed > MAX_PERFORMANCE_PAGES) {
    console.warn(`[playground] clamping ?pages=${parsed} to ${MAX_PERFORMANCE_PAGES}`);
    return MAX_PERFORMANCE_PAGES;
  }
  return parsed;
}

/**
 * Deterministic long-document tail used to exercise streamed layout,
 * virtualization, late-page editing, and incremental tail reuse. Explicit
 * breaks guarantee at least one physical page per generated section.
 */
function performancePages(pageCount: number): Record<string, unknown>[] {
  return Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    return [
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 2, align: "left" },
        content: [{ type: "text", text: `Performance page ${pageNumber}` }],
      },
      {
        type: "paragraph",
        attrs: { align: "left" },
        content: [{
          type: "text",
          text: `Page ${pageNumber} exercises deterministic multi-page layout. Editing this paragraph tests whether an early-page transaction can invalidate and repaint a long document without copying stale blocks from a previous layout.`,
        }],
      },
      {
        type: "paragraph",
        attrs: { align: "justify" },
        content: [{
          type: "text",
          text: "The generated fixture intentionally uses ordinary text rather than large embedded assets. This keeps measurement repeatable while still exercising pagination, CharacterMap population, canvas tile reuse, scrolling, selection, and paragraph splitting across a document much larger than the initial synchronous layout window.",
        }],
      },
      {
        type: "paragraph",
        attrs: { align: "justify" },
        content: [{
          type: "text",
          text: "Incremental layout should preserve exact line positions for unchanged material while recomputing every block affected by an edit. A stable paragraph before a later mutation must never be treated as proof that the remaining document is unchanged, because multiple independent changes can exist in one immutable transaction.",
        }],
      },
      {
        type: "paragraph",
        attrs: { align: "left" },
        content: [{
          type: "text",
          text: "Virtual page rendering keeps memory bounded by recycling canvas tiles outside the viewport. Scrolling through this fixture exercises tile assignment, page-local CharacterMap population, overlay painting, and selection restoration without requiring hundreds of permanent canvas elements.",
        }],
      },
      {
        type: "paragraph",
        attrs: { align: "justify" },
        content: [{
          type: "text",
          text: "The repeated prose is deliberately long enough to create realistic line-breaking work. It includes varied word lengths, punctuation, and spacing so measurement caches receive representative input instead of tiny placeholder strings that would make a large document look artificially inexpensive.",
        }],
      },
      {
        type: "paragraph",
        attrs: { align: "left" },
        content: [{
          type: "text",
          text: `Generated section ${pageNumber} also provides several independent caret targets. Try inserting text near the beginning, splitting a middle paragraph, undoing the change, and then editing this late paragraph to compare warm-cache and cold-path behavior.`,
        }],
      },
      {
        type: "paragraph",
        attrs: { align: "justify" },
        content: [{
          type: "text",
          text: "A correct optimization may avoid repeating measurements and may reuse a verified unchanged suffix, but correctness always comes before reuse. The rendered pixels, hit-test geometry, selection overlay, and immutable editor state must describe the same document generation after every transaction.",
        }],
      },
      {
        type: "paragraph",
        attrs: { align: "left" },
        content: [{
          type: "text",
          text: `End of generated page ${pageNumber}. Use this line for late-document Enter and typing tests.`,
        }],
      },
    ];
  }).flat();
}

const performancePageCount = requestedPageCount();

/** `?demo=track-changes` loads the document for exercising review by hand. */
function requestedDemo(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("demo");
}

/** Which demo the playground shows: everyday editing, or suggestions to review. */
export type DemoKind = "editing" | "track-changes";

export const startingDemo = (): DemoKind => requestedDemo() === "track-changes" ? "track-changes" : "editing";

/** The document for a demo, as JSON the editor can load. */
export const demoDoc = (kind: DemoKind) => kind === "track-changes" ? TRACK_CHANGES_DEMO_DOC : DEMO_DOC;

function startingDoc() {
  if (startingDemo() === "track-changes") return TRACK_CHANGES_DEMO_DOC;
  if (performancePageCount > 0) {
    return {
      ...DEMO_DOC,
      content: [...DEMO_DOC.content, ...performancePages(performancePageCount)],
    };
  }
  return DEMO_DOC;
}

/**
 * DemoContent — seeds the editor with the playground demo document.
 * Drop this extension to start with an empty document instead.
 *
 * Append a long deterministic tail with `?pages=<n>` — e.g. `?pages=200` or
 * `?pages=1000` — to exercise streamed layout, virtualization, and late-page
 * editing at whatever size you want to measure.
 *
 * `?demo=track-changes` loads a document that already holds another author's
 * pending changes, so reviewing and multi-author editing can be driven by hand.
 */
export const DemoContent = DefaultContent.configure({ json: startingDoc() });
