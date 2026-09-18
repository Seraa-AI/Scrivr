/**
 * Fitting a run to the width it was measured to.
 *
 * The PDF paints a layout the editor measured with a different engine, and two
 * engines reading one font file disagree on advance widths by around half a
 * percent. Left alone, every run ends slightly short of its box.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { embedFaces, embedStandardFonts } from "../fonts";
import { buildPdf } from "../index";
import { recordDrawOps } from "./opLog";
import { block, onePage, textLine, exportEditor } from "./fixtures";
import { trackingFor, PT_PER_PX } from "../context";

const standard = await embedStandardFonts(await PDFDocument.create());
const font = standard["sans_normal"]!;
const TEXT = "Retainer and fees payable under this agreement";
const SIZE_PT = 14 * PT_PER_PX;

/** What this face makes of the text, in the units a span's width is given in. */
const naturalPx = font.widthOfTextAtSize(TEXT, SIZE_PT) / PT_PER_PX;

describe("fitting a run to its measured width", () => {
  it("adjusts nothing when the face agrees with the measurement", () => {
    expect(trackingFor(naturalPx, TEXT, font, SIZE_PT)).toBe(0);
  });

  it("spreads the difference across the glyphs", () => {
    const wider = naturalPx + 2 / PT_PER_PX;
    const tracking = trackingFor(wider, TEXT, font, SIZE_PT);

    expect(tracking).toBeGreaterThan(0);
    expect(tracking * [...TEXT].length).toBeCloseTo(2, 5);
  });

  it("tightens when the face draws wider than the measurement", () => {
    expect(trackingFor(naturalPx - 1 / PT_PER_PX, TEXT, font, SIZE_PT)).toBeLessThan(0);
  });

  it("ignores a difference too small to see", () => {
    // Otherwise every span in the document pays for an operator that moves
    // nothing.
    expect(trackingFor(naturalPx + 0.005 / PT_PER_PX, TEXT, font, SIZE_PT)).toBe(0);
  });

  it("refuses a gap too wide to be two engines disagreeing", () => {
    // Engines reading one face differ by a fraction of a percent. A gap of
    // several percent of the em means the run was measured in some other face,
    // and stretching it to fit crushes or scatters the letters — worse than
    // leaving it short.
    const wildlyWider = naturalPx * 1.4;

    expect(trackingFor(wildlyWider, TEXT, font, SIZE_PT)).toBe(0);
  });

  it("leaves empty text alone", () => {
    expect(trackingFor(10, "", font, SIZE_PT)).toBe(0);
  });

  it("counts characters, not code units", async () => {
    // A surrogate pair is one glyph. Dividing by its two code units would
    // spread only half the difference and leave the run short.
    const bytes = readFileSync(
      createRequire(import.meta.url).resolve(
        "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
      ),
    );
    const doc = await PDFDocument.create();
    // Through the package's own embedder, so the face is measured by the same
    // fontkit an export would use.
    const inter = (
      await embedFaces(doc, [
        {
          id: "inter-400",
          family: "Inter",
          weight: 400,
          style: "normal",
          bytes: async () => new Uint8Array(bytes).buffer,
        },
      ])
    ).get("inter-400");
    if (!inter) throw new Error("face was not embedded");

    const text = "a\u{1D400}b"; // three characters, four code units
    expect(text.length).toBe(4);
    expect([...text].length).toBe(3);

    const gapPt = 0.3;
    const natural = inter.widthOfTextAtSize(text, SIZE_PT) / PT_PER_PX;
    const tracking = trackingFor(natural + gapPt / PT_PER_PX, text, inter, SIZE_PT);

    expect(tracking).toBeCloseTo(gapPt / 3, 8);
    expect(tracking).not.toBeCloseTo(gapPt / 4, 8);
  });
});

describe("when a run may be fitted at all", () => {
  const trackingOps = (ops: Awaited<ReturnType<typeof recordDrawOps>>) =>
    ops.filter((op) => op.op === "state" && String(op["value"]).endsWith("Tc"));

  it("leaves a document alone when the face painting it is not the face measured", async () => {
    // With no provider the layout was measured in whatever the browser made of
    // the family and is painted in a standard face. The width difference is a
    // different typeface, not two engines disagreeing, and stretching the run
    // to close it letterspaces the text rather than setting it.
    const ops = await recordDrawOps(() =>
      buildPdf(
        onePage([
          block("paragraph", [textLine("Retainer and fees", { font: "16px Georgia" })]),
          block("paragraph", [textLine("Retainer and fees")]),
        ]),
        exportEditor,
      ),
    );

    expect(trackingOps(ops)).toEqual([]);
  }, 30_000);
});
