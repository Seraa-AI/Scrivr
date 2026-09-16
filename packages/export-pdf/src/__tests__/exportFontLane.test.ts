// @vitest-environment happy-dom
/**
 * What the PDF lane does with a real editor.
 *
 * These drive `exportToPdf` through an actual `Editor` rather than a stand-in,
 * because the thing worth asserting — that the file reproduces the document on
 * screen — is only true if both sides really ran.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import {
  DefaultFontProvider,
  Editor,
  StarterKit,
  TextMeasurer,
  type FontResource,
  type TextMeasureContext,
} from "@scrivr/core";
import { exportToPdf } from "../index";
import { preparePdfLayout } from "../prepareLayout";
import { recordDrawOps } from "./opLog";

// happy-dom ships no 2D context; wire Skia in, as the core setup does.
const contexts = new WeakMap<HTMLCanvasElement, unknown>();
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
  if (id !== "2d") return null;
  let ctx = contexts.get(this);
  if (!ctx) {
    ctx = createCanvas(this.width || 300, this.height || 150).getContext("2d");
    contexts.set(this, ctx);
  }
  return ctx;
  // Asserted because `getContext` is overloaded per context id, and a single
  // implementation cannot satisfy every overload's return type.
} as typeof HTMLCanvasElement.prototype.getContext;

const require_ = createRequire(import.meta.url);
const interBytes = (): ArrayBuffer => {
  const b = readFileSync(require_.resolve("@fontsource/inter/files/inter-latin-400-normal.woff2"));
  return new Uint8Array(b).buffer;
};

const face = (overrides: Partial<FontResource> = {}): FontResource => ({
  id: "inter-400",
  family: "Inter",
  weight: 400,
  style: "normal",
  bytes: async () => interBytes(),
  ...overrides,
});

/**
 * The napi context is a structural superset of the two members the measurer
 * reads. Adapting through a typed parameter keeps the compiler checking that,
 * where an assertion would stop checking anything.
 */
function measureContext(ctx: {
  font: string;
  measureText: (text: string) => TextMetrics;
}): TextMeasureContext {
  return ctx;
}

/** A measurer that can install a face, which happy-dom's FontFace cannot. */
function installingMeasurer(): TextMeasurer {
  const measurer = new TextMeasurer({
    lineHeightMultiplier: 1.2,
    context: measureContext(createCanvas(800, 600).getContext("2d")),
  });
  measurer.installFont = async () => "InstalledFace";
  return measurer;
}

const CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Retainer and fees payable under this agreement." }],
    },
  ],
};

function editorWith(resource: FontResource) {
  return new Editor({
    extensions: [StarterKit],
    fonts: new DefaultFontProvider({ default: resource }),
    textMeasurer: installingMeasurer(),
    content: CONTENT,
  });
}

/** Let the background font preparation and its relayout finish. */
async function settled(editor: Editor) {
  editor.ensureFullLayout();
  for (let i = 0; i < 60; i++) await Promise.resolve();
  editor.ensureFullLayout();
}

describe("the layout a PDF is painted from", () => {
  it("is the one on screen, when the export resolves to the same faces", async () => {
    // Two engines reading one font file disagree on advance widths by enough
    // to move a line break, so recomputing the geometry produces a different
    // document from the one the user is looking at.
    const editor = editorWith(face());
    await settled(editor);

    const prepared = await preparePdfLayout(editor);
    expect(prepared.layout).toBe(editor.layout);
  }, 30_000);

  it("is laid out again when the export cannot use what the screen resolved", async () => {
    // A licence that forbids embedding is resolved past under the export's
    // constraints, so the geometry on screen belongs to a face the file cannot
    // carry and has to be recomputed from one it can.
    const editor = editorWith(face());
    await settled(editor);

    const licensed = face({
      id: "licensed",
      family: "Licensed",
      embedding: { allowed: false, source: "caller" },
    });
    const editorB = new Editor({
      extensions: [StarterKit],
      fonts: new DefaultFontProvider({ default: licensed, resources: [face()] }),
      textMeasurer: installingMeasurer(),
      content: CONTENT,
    });
    await settled(editorB);

    const prepared = await preparePdfLayout(editorB);
    expect(prepared.layout).not.toBe(editorB.layout);
  }, 30_000);

  it("reports the faces it could not honour, and exports anyway", async () => {
    const editor = editorWith(face({ id: "app", family: "App Sans" }));
    await settled(editor);

    const onFontShortfall = vi.fn();
    const pdf = await exportToPdf(editor, { onFontShortfall });

    expect(pdf.length).toBeGreaterThan(0);
    expect(onFontShortfall).toHaveBeenCalledWith([
      expect.objectContaining({ resolved: expect.objectContaining({ family: "App Sans" }) }),
    ]);
  }, 30_000);
});

describe("a weight the inventory does not hold", () => {
  const bold = { type: "text", marks: [{ type: "bold" }], text: "Retainer" };

  it("is drawn by thickening the face, in the file as on the page", async () => {
    // The inventory has one upright regular. The document asks for bold, and
    // nobody owns it — so both lanes thicken what they have rather than one of
    // them quietly setting the heading in body text.
    const editor = new Editor({
      extensions: [StarterKit],
      fonts: new DefaultFontProvider({ default: face() }),
      textMeasurer: installingMeasurer(),
      content: { type: "doc", content: [{ type: "paragraph", content: [bold] }] },
    });
    await settled(editor);

    const ops = await recordDrawOps(() => exportToPdf(editor));
    const state = ops.filter((op) => op.op === "state").map((op) => String(op["value"]));

    // Tr 2 is fill-and-outline; the width is the stroke that stands in for the
    // weight, and Tr 0 puts the page back to filling.
    expect(state.some((value) => value.endsWith("2 Tr"))).toBe(true);
    expect(state.some((value) => value.endsWith("w"))).toBe(true);
    expect(state.some((value) => value.endsWith("0 Tr"))).toBe(true);
  }, 30_000);

  it("is left alone when the inventory holds the weight", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      fonts: new DefaultFontProvider({
        default: face(),
        resources: [face({ id: "inter-700", weight: 700 })],
      }),
      textMeasurer: installingMeasurer(),
      content: { type: "doc", content: [{ type: "paragraph", content: [bold] }] },
    });
    await settled(editor);

    const ops = await recordDrawOps(() => exportToPdf(editor));
    const state = ops.filter((op) => op.op === "state").map((op) => String(op["value"]));

    expect(state.some((value) => value.endsWith("Tr"))).toBe(false);
  }, 30_000);
});
