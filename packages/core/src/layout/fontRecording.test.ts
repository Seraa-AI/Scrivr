/**
 * What a laid-out document says about the faces it was measured in.
 *
 * The resolver answering correctly is not enough: the answer has to survive
 * onto the spans a consumer actually reads. An exporter reproducing this
 * geometry reads placed spans and the layout's table — if the id is dropped
 * anywhere between the two, the recording exists and nothing can use it, and
 * the exporter goes back to guessing a face from the family name.
 */

import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import type { LayoutSpan } from "./LineBreaker";
import { DefaultFontProvider } from "../fonts/DefaultFontProvider";
import type { FontResource } from "../fonts/types";
import { createMeasurer, createTestEditor } from "../test-utils";
import { getSchema } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";

const schema = getSchema([StarterKit.configure({ table: true })]);

const resource = (family: string, weight = 400): FontResource => ({
  id: `${family}-${weight}`,
  family,
  weight,
  style: "normal",
  bytes: () => Promise.resolve(new ArrayBuffer(8)),
});

/** Nobody owns Aptos here, so every run resolves to the application default. */
const fonts = () => new DefaultFontProvider({ default: resource("App Sans") });

const aptos = (text: string): Node =>
  schema.node("paragraph", null, [
    schema.text(text, [schema.marks["fontFamily"]!.create({ family: "Aptos" })]),
  ]);

function layoutOf(doc: Node) {
  const editor = createTestEditor({ extensions: [StarterKit.configure({ table: true })], content: doc.toJSON(), fonts: fonts() });
  editor.ensureFullLayout();
  return editor.layout;
}

const textSpans = (layout: ReturnType<typeof layoutOf>): LayoutSpan[] =>
  layout.pages
    .flatMap((page) => page.blocks)
    .flatMap((block) => block.lines)
    .flatMap((line) => line.spans)
    .filter((span) => span.kind === "text" && span.text.trim().length > 0);

describe("a laid-out document's font record", () => {
  it("retries a canvas installation that failed on an earlier layout", async () => {
    const measurer = createMeasurer();
    let attempts = 0;
    measurer.installFont = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary font backend failure");
      return "RecoveredFace";
    };
    const content = schema.node("doc", null, [aptos("Retainer and fees")]).toJSON();
    const editor = createTestEditor({ content, fonts: fonts(), textMeasurer: measurer });

    for (let i = 0; i < 20; i++) await Promise.resolve();
    const replacement = editor.schema.nodeFromJSON(content);
    editor.applyTransaction(
      editor.getState().tr.replaceWith(0, editor.getState().doc.content.size, replacement.content),
    );
    for (let i = 0; i < 20; i++) await Promise.resolve();
    editor.ensureFullLayout();

    expect(attempts).toBeGreaterThanOrEqual(2);
    const installed = [...(editor.layout.fontResolutions?.values() ?? [])]
      .find((answer) => answer.request.family === "Aptos");
    expect(installed?.measuredAs).toBe("RecoveredFace");
  });

  it("carries the resolution onto every placed span", () => {
    const layout = layoutOf(schema.node("doc", null, [aptos("Retainer and fees")]));
    const spans = textSpans(layout);

    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.kind === "text" && span.resolution).toBeDefined();
    }
  });

  it("names the face the spans were measured in, not the one asked for", () => {
    const layout = layoutOf(schema.node("doc", null, [aptos("Retainer and fees")]));
    const [span] = textSpans(layout);

    expect(span?.kind === "text" && span.font).toContain("App Sans");
    const resolution =
      span?.kind === "text" && span.resolution !== undefined
        ? layout.fontResolutions?.get(span.resolution)
        : undefined;
    expect(resolution?.resolved.family).toBe("App Sans");
    expect(resolution?.request.family).toBe("Aptos");
  });

  it("survives onto a paragraph long enough to wrap", () => {
    // Wrapping runs the spans back through tokenising and placement, which is
    // where a field that is only set on the way in gets lost.
    const long = "Retainer and fees payable under this agreement ".repeat(12);
    const spans = textSpans(layoutOf(schema.node("doc", null, [aptos(long)])));

    expect(spans.length).toBeGreaterThan(1);
    expect(
      spans.every((span) => span.kind === "text" && span.resolution !== undefined),
    ).toBe(true);
  });

  it("carries the resolution into table cells", () => {
    // Cell text is document text. It reached the PDF measured in the family
    // nobody owned and painted in a standard face — the original bug, alive
    // inside tables long after the body text was fixed.
    const cell = (text: string) =>
      schema.node("tableCell", null, [aptos(text)]);
    const doc = schema.node("doc", null, [
      schema.node("table", null, [
        schema.node("tableRow", null, [cell("Effective Date"), cell("Fees")]),
      ]),
    ]);

    const spans = layoutOf(doc)
      .pages.flatMap((page) => page.blocks)
      .flatMap((row) => row.cells ?? [])
      .flatMap((c) => c.blocks ?? [])
      .flatMap((b) => b.lines ?? [])
      .flatMap((l) => l.spans)
      .filter((span) => span.kind === "text" && span.text.trim().length > 0);

    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.kind === "text" && span.font).toContain("App Sans");
      expect(span.kind === "text" && span.resolution).toBeDefined();
    }
  });

  it("leaves an atom nothing measures out of the font record", () => {
    // An image has fixed dimensions and is not set in a face. Resolving one
    // for it would enter the layout's table and report a substitution for a
    // typeface nothing is drawn in.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Fee ", [schema.marks["fontFamily"]!.create({ family: "Aptos" })]),
        schema.node("image", { src: "data:image/png;base64,iVBORw0KGgo=", width: 10, height: 10 }),
      ]),
    ]);
    const objects = layoutOf(doc)
      .pages.flatMap((page) => page.blocks)
      .flatMap((block) => block.lines)
      .flatMap((line) => line.spans)
      .filter((span) => span.kind === "object");

    expect(objects.length).toBeGreaterThan(0);
    for (const span of objects) {
      expect(span.kind === "object" && span.font).toBeUndefined();
      expect(span.kind === "object" && span.resolution).toBeUndefined();
    }
  });

  it("claims nothing when the editor has no provider", () => {
    const editor = createTestEditor({ extensions: [StarterKit.configure({ table: true })], content: schema.node("doc", null, [aptos("Fees")]).toJSON() });
    editor.ensureFullLayout();

    expect(editor.layout.fontResolutions?.size ?? 0).toBe(0);
    expect(
      textSpans(editor.layout).every((s) => s.kind === "text" && s.resolution === undefined),
    ).toBe(true);
  });
});
