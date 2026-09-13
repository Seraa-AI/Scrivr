/**
 * An extension styling its own mark in the PDF.
 *
 * The handler table existed and was wired to nothing — `createDrawHelpers`
 * took it as a parameter and never read it, and the export never collected it
 * from a contribution. These assert a mark an extension declares actually
 * reaches the page, because a lane that compiles is not a lane that runs.
 */

import { describe, it, expect } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { buildPdf } from "../index";
import { recordDrawOps, type DrawOp } from "./opLog";
import { block, onePage, textLine } from "./fixtures";

const Shouty = Extension.create({
  name: "shouty",
  addExports() {
    return {
      pdf: {
        marks: {
          // Deliberately unlike any built-in default, so a pass cannot come
          // from the hardcoded path that used to own this.
          shout: () => ({
            color: "#ff00ff",
            strikethrough: true,
            backgroundColor: { color: "#00ff00", opacity: 0.25 },
          }),
        },
      },
    };
  },
});

const withShout = onePage([
  block("paragraph", [textLine("loud", { marks: [{ name: "shout", attrs: {} }] })]),
]);

const record = (editor: ServerEditor) =>
  recordDrawOps(() => buildPdf(withShout, editor));

describe("a mark an extension owns", () => {
  it("styles the span it covers", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Shouty] });
    const ops = await record(editor);

    const text = ops.find((op) => op.op === "text" && op["value"] === "loud");
    expect(text?.["color"]).toBe("rgb(1, 0, 1)");
    expect(ops.some((op) => op.op === "line")).toBe(true);
    expect(ops.some((op) => op.op === "rect" && op["opacity"] === 0.25)).toBe(true);
  });

  it("does nothing when the extension is absent", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });

    const ops = await record(editor);

    const text = ops.find((op) => op.op === "text" && op["value"] === "loud");
    // Falls back to the theme's default text colour, undecorated.
    expect(text?.["color"]).not.toBe("rgb(1, 0, 1)");
    expect(ops.some((op) => op.op === "line")).toBe(false);
    expect(ops.some((op) => op.op === "rect" && op["opacity"] === 0.25)).toBe(false);
  });
});

describe("a built-in mark declared by its own extension", () => {
  const highlighted = (attrs: Record<string, unknown>) =>
    onePage([
      block("paragraph", [textLine("lit", { marks: [{ name: "highlight", attrs }] })]),
    ]);

  const editor = new ServerEditor({ extensions: [StarterKit] });

  /**
   * The highlight rect, which is the one drawn immediately before the text it
   * sits behind. Every page also opens with a full-page background rect, and
   * finding that one instead is an easy way to write a test that proves
   * nothing.
   */
  const highlightRect = (ops: DrawOp[]) => {
    const textAt = ops.findIndex((op) => op.op === "text");
    const before = ops[textAt - 1];
    return before?.op === "rect" ? before : undefined;
  };

  it("highlights in the colour the extension configures, not one the exporter invented", async () => {
    // Highlight's own default is rgba(255, 220, 0, 0.4) — the colour the
    // canvas paints. The exporter used to hardcode a different yellow, so the
    // same document highlighted differently depending on where you looked.
    const ops = await recordDrawOps(() => buildPdf(highlighted({}), editor));
    const rect = highlightRect(ops);
    expect(rect?.["color"]).toBe("rgb(1, 0.863, 0)");
    expect(rect?.["opacity"]).toBe(0.4);
  });

  it("carries an empty colour attribute back to the configured default", async () => {
    const ops = await recordDrawOps(() => buildPdf(highlighted({ color: "" }), editor));
    expect(highlightRect(ops)?.["color"]).toBe("rgb(1, 0.863, 0)");
  });

  it("reads an alpha in the colour as the opacity", async () => {
    const ops = await recordDrawOps(() =>
      buildPdf(highlighted({ color: "rgba(255, 0, 0, 0.25)" }), editor),
    );
    const rect = highlightRect(ops);
    expect(rect?.["color"]).toBe("rgb(1, 0, 0)");
    expect(rect?.["opacity"]).toBe(0.25);
  });

  it("paints an opaque highlight behind the words rather than over them", async () => {
    const ops = await recordDrawOps(() => buildPdf(highlighted({ color: "#fef08a" }), editor));
    // Opaque, because behind the glyphs there is nothing to see through.
    expect(highlightRect(ops)?.["opacity"]).toBe(1);
  });
});
