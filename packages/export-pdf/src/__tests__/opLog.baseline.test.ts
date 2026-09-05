import { describe, it, expect } from "vitest";
import { buildPdf } from "../index";
import { recordDrawOps } from "./opLog";
import {
  AVAIL_W,
  block,
  exportEditor,
  layout,
  onePage,
  schema,
  tableRowBlock,
  textLine,
} from "./fixtures";

/**
 * The characterization baseline: what today's exporter draws, recorded before
 * anything moves.
 *
 * Every phase of the format-lane migration is gated on these snapshots not
 * changing. They are deliberately unassertive about whether the rendering is
 * *right* — a wrong rendering preserved is still a successful migration, and
 * fixing it is a separate change with its own before/after.
 */

const record = (doc: Parameters<typeof buildPdf>[0]) =>
  recordDrawOps(() => buildPdf(doc, exportEditor));

describe("baseline — node rendering", () => {
  it("paragraph", async () => {
    expect(await record(onePage([block("paragraph", [textLine("Hello world")])]))).toMatchSnapshot();
  });

  it("heading", async () => {
    expect(
      await record(onePage([block("heading", [textLine("Title", { font: "bold 24px Helvetica" })], { attrs: { level: 1 } })])),
    ).toMatchSnapshot();
  });

  it("codeBlock", async () => {
    expect(
      await record(onePage([block("codeBlock", [textLine("const x = 1;", { font: "14px Courier" })])])),
    ).toMatchSnapshot();
  });

  it("horizontalRule", async () => {
    expect(await record(onePage([block("horizontalRule", [])]))).toMatchSnapshot();
  });

  it("listItem with a marker", async () => {
    expect(
      await record(onePage([block("listItem", [textLine("First")], { listMarker: "1." })])),
    ).toMatchSnapshot();
  });

  it("a table row, shaded and merged", async () => {
    expect(await record(onePage([tableRowBlock()]))).toMatchSnapshot();
  });

  it("content continuing onto a second page", async () => {
    expect(
      await record(
        layout([
          [block("paragraph", [textLine("Page one")])],
          [block("paragraph", [textLine("Page two")])],
        ]),
      ),
    ).toMatchSnapshot();
  });
});

describe("baseline — text placement", () => {
  it("centred", async () => {
    expect(
      await record(onePage([block("paragraph", [textLine("Centred")], { align: "center" })])),
    ).toMatchSnapshot();
  });

  it("a positioned line, as a float wrap produces", async () => {
    expect(
      await record(onePage([block("paragraph", [textLine("Wrapped", { x: 120, positioned: true })])])),
    ).toMatchSnapshot();
  });

  it("several lines in one block", async () => {
    expect(
      await record(
        onePage([block("paragraph", [textLine("One"), textLine("Two"), textLine("Three")])]),
      ),
    ).toMatchSnapshot();
  });
});

describe("baseline — mark rendering", () => {
  const withMarks = (marks: Array<{ name: string; attrs: Record<string, unknown> }>) =>
    onePage([block("paragraph", [textLine("Marked", { marks })])]);

  it("underline", async () => {
    expect(await record(withMarks([{ name: "underline", attrs: {} }]))).toMatchSnapshot();
  });

  it("strikethrough", async () => {
    expect(await record(withMarks([{ name: "strikethrough", attrs: {} }]))).toMatchSnapshot();
  });

  it("highlight — the rectangle lands after the text", async () => {
    const ops = await record(withMarks([{ name: "highlight", attrs: { color: "#fef08a" } }]));
    expect(ops).toMatchSnapshot();
    // Stated as its own assertion because the whole mark contract in the RFC
    // turns on this ordering, and a snapshot alone would let it change quietly.
    const kinds = ops.map((op) => op.op);
    expect(kinds.indexOf("rect", kinds.indexOf("text"))).toBeGreaterThan(kinds.indexOf("text"));
  });

  it("link", async () => {
    expect(
      await record(withMarks([{ name: "link", attrs: { href: "https://example.com" } }])),
    ).toMatchSnapshot();
  });

  it("colour", async () => {
    expect(await record(withMarks([{ name: "color", attrs: { color: "#dc2626" } }]))).toMatchSnapshot();
  });

  it("link and underline together draw two lines", async () => {
    const ops = await record(
      withMarks([
        { name: "link", attrs: { href: "https://example.com" } },
        { name: "underline", attrs: {} },
      ]),
    );
    expect(ops).toMatchSnapshot();
    expect(ops.filter((op) => op.op === "line")).toHaveLength(2);
  });

  it("an explicit colour with a link — the colour wins for text, not for the underline", async () => {
    expect(
      await record(
        withMarks([
          { name: "link", attrs: { href: "https://example.com" } },
          { name: "color", attrs: { color: "#dc2626" } },
        ]),
      ),
    ).toMatchSnapshot();
  });

  it("every decoration at once", async () => {
    expect(
      await record(
        withMarks([
          { name: "highlight", attrs: { color: "#fef08a" } },
          { name: "underline", attrs: {} },
          { name: "strikethrough", attrs: {} },
          { name: "color", attrs: { color: "#2563eb" } },
        ]),
      ),
    ).toMatchSnapshot();
  });
});

describe("baseline — anchored objects", () => {
  const anchored = (wrapMode: string) =>
    layout(
      [[block("paragraph", [textLine("Body text")])]],
      [
        {
          docPos: 1,
          page: 1,
          x: 100,
          y: 200,
          width: 120,
          height: 80,
          wrapMode,
          node: schema.nodes["image"]!.create({ src: "missing.png", width: 120, height: 80 }),
        },
      ] as unknown as ReturnType<typeof layout>["anchoredObjects"],
    );

  it("an unresolved image draws its placeholder", async () => {
    expect(await record(anchored("square-left"))).toMatchSnapshot();
  });

  it("behind-text wrap paints in its own pass", async () => {
    expect(await record(anchored("behind"))).toMatchSnapshot();
  });
});

describe("baseline — the page itself", () => {
  it("an empty document still paints the page background", async () => {
    expect(await record(onePage([]))).toMatchSnapshot();
  });

  it("the full content width is available to a block", async () => {
    expect(AVAIL_W).toBe(468);
  });
});
