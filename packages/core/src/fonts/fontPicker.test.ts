/**
 * What a font picker is allowed to offer.
 *
 * The FontFamily extension declares its presets in phase 1, before any editor
 * exists, so it cannot know what the editor it ends up in can render. With an
 * inventory in play those presets become five names that all resolve to one
 * typeface — a control that appears to do something and does not.
 */

import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { createInstallingMeasurer, createTestEditor } from "../test-utils";
import { getSchema } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";

const schema = getSchema([StarterKit]);
import { DefaultFontProvider } from "./DefaultFontProvider";
import type { FontResource } from "./types";

const resource = (family: string, weight = 400): FontResource => ({
  id: `${family}-${weight}`,
  family,
  weight,
  style: "normal",
  embedding: { allowed: true, source: "caller" },
  bytes: () => Promise.resolve(new ArrayBuffer(8)),
});

const familyItems = (editor: ReturnType<typeof createTestEditor>) =>
  editor.toolbarItems.filter((item) => item.group === "family");

describe("the families a picker may offer", () => {
  it("offers what the inventory holds, not the extension's guesses", () => {
    const editor = createTestEditor({
      fonts: new DefaultFontProvider({
        default: resource("Inter"),
        resources: [resource("Inter", 700), resource("Source Serif")],
      }),
    });

    expect(editor.fontFamilies.map((option) => option.family)).toEqual([
      "Inter",
      "Source Serif",
    ]);
    expect(familyItems(editor).map((item) => item.args?.[0])).toEqual([
      "Inter",
      "Source Serif",
    ]);
  });

  it("keeps the faces behind each family, so a control can say what it has", () => {
    // One entry per family — bold and italic are marks with their own controls
    // — but a control that knows Inter has a real bold and Source Serif does
    // not can say so before a heading is set in the wrong one.
    const editor = createTestEditor({
      fonts: new DefaultFontProvider({
        default: resource("Inter"),
        resources: [resource("Inter", 700), resource("Source Serif")],
      }),
    });

    const [inter, serif] = editor.fontFamilies;
    expect(inter?.faces.map((face) => face.weight)).toEqual([400, 700]);
    expect(serif?.faces.map((face) => face.weight)).toEqual([400]);
  });

  it("offers a family the host can draw but nobody owns", () => {
    // It renders on screen, so it is a real choice. Refusing it belongs to the
    // export, which says so rather than dropping it silently.
    const editor = createTestEditor({
      fonts: new DefaultFontProvider({
        default: resource("Inter"),
        systemCandidates: ["Courier New"],
      }),
    });

    expect(editor.fontFamilies.map((option) => option.family)).toEqual([
      "Inter",
      "Courier New",
    ]);
    // Nothing owns bytes for it, which is what tells a control that choosing it
    // means the exported document will be set in something else. Its faces are
    // unknown rather than assumed — the host may well have a bold.
    const hostOnly = editor.fontFamilies.find((o) => o.family === "Courier New");
    expect(hostOnly?.portable).toBe(false);
    expect(hostOnly?.faces).toEqual([]);
    expect(editor.fontFamilies.find((o) => o.family === "Inter")?.portable).toBe(true);
  });

  it("keeps the extension's presets when nothing was claimed", () => {
    // No provider means no promise was made, so the configured list is all
    // there is and removing it would leave the control empty.
    const editor = createTestEditor();

    expect(editor.fontFamilies).toEqual([]);
    expect(familyItems(editor).length).toBeGreaterThan(0);
  });

  it("leaves every other toolbar group in place", () => {
    const plain = createTestEditor();
    const withFonts = createTestEditor({
      fonts: new DefaultFontProvider({ default: resource("Inter") }),
    });

    const others = (e: ReturnType<typeof createTestEditor>) =>
      e.toolbarItems.filter((i) => i.group !== "family").map((i) => i.command);

    expect(others(withFonts)).toEqual(others(plain));
  });
});

describe("what the editor reports about substitution", () => {
  const aptos = (text: string) =>
    schema.node("paragraph", null, [
      schema.text(text, [schema.marks["fontFamily"]!.create({ family: "Aptos" })]),
    ]);

  const inter = (text: string) =>
    schema.node("paragraph", null, [
      schema.text(text, [schema.marks["fontFamily"]!.create({ family: "Inter" })]),
    ]);

  /** Installs its faces, as a browser would — otherwise every answer is generic. */
  const withProvider = (content: Node) =>
    createTestEditor({
      textMeasurer: createInstallingMeasurer(),
      fonts: new DefaultFontProvider({
        default: resource("Inter"),
        resources: [resource("Inter", 700)],
      }),
      content: content.toJSON(),
    });

  it("lists every face the document asked for and did not get", async () => {
    const editor = withProvider(schema.node("doc", null, [aptos("Retainer")]));
    editor.ensureFullLayout();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    editor.ensureFullLayout();

    expect(editor.fontSubstitutions).toHaveLength(1);
    expect(editor.fontSubstitutions[0]).toMatchObject({
      request: { family: "Aptos" },
      resolved: { family: "Inter" },
      source: "default",
    });
  });

  it("names the typeface, never the alias it is measured under", async () => {
    // Owned bytes install under a private name so an OS font of the same
    // family cannot answer instead. That name is a measurement detail — a
    // reader told "Aptos became TestFace0" has learned nothing.
    const editor = withProvider(schema.node("doc", null, [aptos("Retainer")]));
    editor.ensureFullLayout();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    editor.ensureFullLayout();

    const [missed] = editor.fontSubstitutions;
    expect(missed?.resolved.family).toBe("Inter");
    expect(editor.getActiveFontFamily().resolved).toBe("Inter");
  });

  it("returns the same array until the layout changes", () => {
    // A getter that rebuilt its result would re-render every subscriber on
    // every editor notification.
    const editor = withProvider(schema.node("doc", null, [aptos("Retainer")]));
    editor.ensureFullLayout();
    const first = editor.fontSubstitutions;

    expect(editor.fontSubstitutions).toBe(first);

    const state = editor.getState();
    editor.applyTransaction(state.tr.insertText("x", 2));
    editor.ensureFullLayout();
    expect(editor.fontSubstitutions).not.toBe(first);
  });

  it("claims nothing when every face was honoured", async () => {
    const editor = withProvider(schema.node("doc", null, [inter("Retainer")]));
    editor.ensureFullLayout();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    editor.ensureFullLayout();

    expect(editor.fontSubstitutions).toEqual([]);
  });

  it("forgets a face the document no longer uses", async () => {
    // The resolver's table is cumulative so ids on cached spans stay valid.
    // Reporting reads the document instead, or a family applied once and
    // undone is still being complained about at the end of the session.
    const editor = withProvider(
      schema.node("doc", null, [aptos("Retainer"), inter("Fees")]),
    );
    editor.ensureFullLayout();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    editor.ensureFullLayout();
    expect(editor.fontSubstitutions).toHaveLength(1);

    const state = editor.getState();
    editor.applyTransaction(state.tr.delete(0, state.doc.firstChild!.nodeSize));
    editor.ensureFullLayout();

    // Only the Inter paragraph is left, and Inter is owned — nothing to report.
    expect(editor.fontSubstitutions).toEqual([]);
  });

  it("reports the family at the selection and the one it is drawn in", () => {
    const editor = withProvider(schema.node("doc", null, [aptos("Retainer")]));
    const state = editor.getState();
    editor.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, 2, 5)),
    );

    expect(editor.getActiveFontFamily()).toEqual({
      requested: "Aptos",
      resolved: "Inter",
      substituted: true,
    });
  });

  it("strips the fallback list from the document default", () => {
    // "Arial, sans-serif" is one request and a chain of host fallbacks; a
    // control showing the whole list describes something nobody asked for.
    const editor = withProvider(schema.node("doc", null, [schema.node("paragraph")]));

    expect(editor.getActiveFontFamily().requested).toBe("Arial");
  });

  it("says which face answered, not just which family", async () => {
    // Scrivr does not synthesize a weight it was not given, so an inventory
    // holding one weight answers bold with regular. Reporting the family alone
    // cannot tell "your document is in a different typeface" from "your
    // headings are no longer bold".
    const editor = createTestEditor({
      textMeasurer: createInstallingMeasurer(),
      fonts: new DefaultFontProvider({ default: resource("Inter") }),
      content: schema
        .node("doc", null, [
          schema.node("paragraph", null, [
            schema.text("Retainer", [
              schema.marks["fontFamily"]!.create({ family: "Inter" }),
              schema.marks["bold"]!.create(),
            ]),
          ]),
        ])
        .toJSON(),
    });
    editor.ensureFullLayout();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    editor.ensureFullLayout();

    const [missed] = editor.fontSubstitutions;
    expect(missed?.request).toMatchObject({ family: "Inter", weight: 700 });
    expect(missed?.resolved).toMatchObject({ family: "Inter", weight: 400 });
  });

  it("says nothing was substituted when no provider was supplied", () => {
    const editor = createTestEditor({
      content: schema.node("doc", null, [aptos("Retainer")]).toJSON(),
    });

    expect(editor.getActiveFontFamily()).toEqual({
      requested: "Aptos",
      resolved: "Aptos",
      substituted: false,
    });
  });
});
