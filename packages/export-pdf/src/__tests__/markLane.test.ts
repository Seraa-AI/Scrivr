import { describe, it, expect } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import type { PdfMarkStyler } from "@scrivr/core";
import { buildPdf } from "../index";
import { recordDrawOps } from "./opLog";
import { block, onePage, textLine } from "./fixtures";

/**
 * The mark lane carries a contribution end to end.
 *
 * Until now `PdfExports.marks` was typed, documented and read by nobody: an
 * extension could ship a mark styler, it compiled, and it drew nothing. These
 * assert the lane is live — a styler an extension registers reaches the page.
 */

const marked = (
  editor: ServerEditor,
  marks: Array<{ name: string; attrs: Record<string, unknown> }>,
) =>
  recordDrawOps(() =>
    buildPdf(onePage([block("paragraph", [textLine("Marked", { marks })])]), editor),
  );

/** An extension that owns a mark nothing in core knows about. */
function withStyler(name: string, styler: PdfMarkStyler) {
  const Ext = Extension.create({
    name: `${name}Styling`,
    addExports() {
      return { pdf: { marks: { [name]: styler } } };
    },
  });
  return new ServerEditor({ extensions: [StarterKit, Ext] });
}

describe("a contributed mark styler reaches the page", () => {
  it("draws a decoration the painter placed", async () => {
    const editor = withStyler("citation", () => ({
      decorations: [{ kind: "underline", color: { r: 0, g: 128, b: 0 }, source: "citation" }],
    }));
    const ops = await marked(editor, [{ name: "citation", attrs: {} }]);

    const lines = ops.filter((op) => op.op === "line");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["color"]).toBe("rgb(0, 0.502, 0)");
  });

  it("draws a background at the alpha the contribution asked for", async () => {
    const editor = withStyler("flagged", () => ({
      backgrounds: [{ color: { r: 255, g: 0, b: 0, alpha: 0.25 }, phase: "afterText" }],
    }));
    const ops = await marked(editor, [{ name: "flagged", attrs: {} }]);

    const rects = ops.filter((op) => op.op === "rect" && op["opacity"] === 0.25);
    expect(rects).toHaveLength(1);
  });

  it("takes the text fill when nothing outranks it", async () => {
    const editor = withStyler("brand", () => ({
      foreground: { color: { r: 0, g: 0, b: 255 }, source: "brand" },
    }));
    const ops = await marked(editor, [{ name: "brand", attrs: {} }]);

    expect(ops.find((op) => op.op === "text")?.["color"]).toBe("rgb(0, 0, 1)");
  });

  // The precedence rule is the painter's, not a number a styler picks, so an
  // extension cannot escalate its way past a mark the rule ranks higher.
  it("does not take the fill from an explicit colour", async () => {
    const editor = withStyler("brand", () => ({
      foreground: { color: { r: 0, g: 0, b: 255 }, source: "brand" },
    }));
    const ops = await marked(editor, [
      { name: "brand", attrs: {} },
      { name: "color", attrs: { color: "#dc2626" } },
    ]);

    expect(ops.find((op) => op.op === "text")?.["color"]).toBe("rgb(0.863, 0.149, 0.149)");
  });

  it("a styler for a mark the span does not carry draws nothing", async () => {
    const editor = withStyler("citation", () => ({
      decorations: [{ kind: "underline", color: { r: 0, g: 128, b: 0 }, source: "citation" }],
    }));
    const ops = await marked(editor, []);
    expect(ops.filter((op) => op.op === "line")).toEqual([]);
  });

  it("paints marks in the order the span carries them", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    const highlightFirst = await marked(editor, [
      { name: "highlight", attrs: { color: "#fef08a" } },
      { name: "underline", attrs: {} },
    ]);
    const underlineFirst = await marked(editor, [
      { name: "underline", attrs: {} },
      { name: "highlight", attrs: { color: "#fef08a" } },
    ]);

    // Same two drawings, opposite order — grouping marks by kind would lose it.
    expect(highlightFirst.map((op) => op.op)).toEqual(["rect", "text", "rect", "line"]);
    expect(underlineFirst.map((op) => op.op)).toEqual(["rect", "text", "line", "rect"]);
  });
});
