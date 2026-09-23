/**
 * What a document asks for, answered before anything is measured.
 *
 * The question is small — a document names a handful of faces and repeats them
 * across thousands of runs — and it is knowable without measuring, which is
 * what lets the answers be settled before geometry depends on them.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { DefaultFontProvider } from "./DefaultFontProvider";
import { collectFontRequests, prepareDocumentFonts, usedResolutions } from "./collectFontRequests";
import type { LayoutBlock } from "../layout/BlockLayout";
import type { DocumentLayout } from "../layout/PageLayout";
import type { FontResource } from "./types";

const resource = (family: string, weight = 400, style: "normal" | "italic" = "normal"): FontResource => ({
  id: `${family}-${weight}-${style}`,
  family,
  weight,
  style,
  bytes: () => Promise.resolve(new ArrayBuffer(8)),
});

const appDefault = resource("App Sans");

const docOf = (content: unknown) => {
  const editor = new ServerEditor();
  editor.setContent(content as Parameters<ServerEditor["setContent"]>[0]);
  return editor.getState().doc;
};

const text = (value: string, marks: Array<Record<string, unknown>> = []) => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks } : {}),
});

const para = (...content: unknown[]) => ({ type: "paragraph", content });

const fallback = { family: "App Sans", weight: 400, style: "normal" as const, size: 14 };

describe("collecting what a document asks for", () => {
  it("counts a face once however many runs use it", () => {
    const doc = docOf({
      type: "doc",
      content: [
        para(text("a", [{ type: "fontFamily", attrs: { family: "Inter" } }])),
        para(text("b", [{ type: "fontFamily", attrs: { family: "Inter" } }])),
      ],
    });
    expect(collectFontRequests(doc, fallback)).toHaveLength(1);
  });

  it("treats bold and italic as different faces", () => {
    // Key on family alone and bold reproduces the family bug a release later.
    const doc = docOf({
      type: "doc",
      content: [
        para(
          text("plain", [{ type: "fontFamily", attrs: { family: "Inter" } }]),
          text("bold", [{ type: "fontFamily", attrs: { family: "Inter" } }, { type: "bold" }]),
          text("both", [
            { type: "fontFamily", attrs: { family: "Inter" } },
            { type: "bold" },
            { type: "italic" },
          ]),
        ),
      ],
    });
    const found = collectFontRequests(doc, fallback);
    expect(found).toHaveLength(3);
    expect(found.map((r) => `${r.weight}/${r.style}`).sort()).toEqual([
      "400/normal",
      "700/italic",
      "700/normal",
    ]);
  });

  it("asks for the default on text nobody styled", () => {
    // Unstyled text is not absent from the question — it carries the
    // document's default, which is a request like any other.
    const doc = docOf({ type: "doc", content: [para(text("plain"))] });
    expect(collectFontRequests(doc, fallback)).toEqual([fallback]);
  });

  it("asks for the default even for an empty document", () => {
    const doc = docOf({ type: "doc", content: [para()] });
    expect(collectFontRequests(doc, fallback)).toEqual([fallback]);
  });
});

describe("preparing a document's fonts", () => {
  const provider = (extra: Partial<ConstructorParameters<typeof DefaultFontProvider>[0]> = {}) =>
    new DefaultFontProvider({ default: appDefault, ...extra });

  const docWith = (family: string) =>
    docOf({
      type: "doc",
      content: [para(text("x", [{ type: "fontFamily", attrs: { family } }]))],
    });

  it("says nothing when every face was supplied", async () => {
    const inter = resource("Inter");
    const shortfalls = await prepareDocumentFonts(docWith("Inter"), provider({ resources: [inter] }));
    expect(shortfalls).toEqual([]);
  });

  it("reports a face that fell back to the default", async () => {
    const shortfalls = await prepareDocumentFonts(docWith("Aptos"), provider());
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0]).toMatchObject({
      resolved: expect.objectContaining({ family: "App Sans" }),
      source: "default",
      portable: true,
    });
    expect(shortfalls[0]?.request.family).toBe("Aptos");
  });

  it("reports a face the host can draw but nobody can carry", async () => {
    const shortfalls = await prepareDocumentFonts(
      docWith("Aptos"),
      provider({ systemCandidates: ["Aptos"] }),
    );
    // It is the face that was asked for — and it does not leave this machine.
    expect(shortfalls[0]).toMatchObject({ source: "requested", portable: false });
  });

  it("gives an export a different answer than the screen, by constraint", async () => {
    const p = provider({ systemCandidates: ["Aptos"] });
    const doc = docWith("Aptos");

    const onScreen = await prepareDocumentFonts(doc, p);
    const forExport = await prepareDocumentFonts(doc, p, { portable: true });

    expect(onScreen[0]?.source).toBe("requested");
    expect(forExport[0]?.source).toBe("default");
  });
});

/**
 * Which faces a finished layout actually paints.
 *
 * The exporter prepares exactly these, so a face this misses is a face the
 * PDF cannot embed — it falls back to a standard font and drops every glyph
 * that font has no room for, with no shortfall to report it.
 */
describe("which faces a layout uses", () => {
  const blockUsing = (resolution: number) =>
    ({
      lines: [{ spans: [{ kind: "text", text: "x", font: "16px Inter", x: 0, width: 10, docPos: 0, resolution }] }],
    }) as unknown as LayoutBlock;

  const pageOf = (...blocks: LayoutBlock[]) => ({ pageNumber: 1, blocks });

  it("counts a face used only in a header", () => {
    const header = { layout: { pages: [pageOf(blockUsing(2))] } };
    const layout = {
      pages: [pageOf(blockUsing(1))],
      chromePayloads: { headerFooter: { slots: { defaultHeader: header } } },
    } as unknown as DocumentLayout;

    expect([...usedResolutions(layout)].sort()).toEqual([1, 2]);
  });

  it("counts a face used only in a table cell", () => {
    const row = { lines: [], cells: [{ blocks: [blockUsing(3)] }] } as unknown as LayoutBlock;
    const layout = { pages: [pageOf(row)] } as unknown as DocumentLayout;

    expect([...usedResolutions(layout)]).toEqual([3]);
  });
});
