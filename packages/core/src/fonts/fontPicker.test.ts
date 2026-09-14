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
import { createTestEditor } from "../test-utils";
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

    expect(editor.fontFamilies).toEqual(["Inter", "Source Serif"]);
    expect(familyItems(editor).map((item) => item.args?.[0])).toEqual([
      "Inter",
      "Source Serif",
    ]);
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

    expect(editor.fontFamilies).toEqual(["Inter", "Courier New"]);
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

  const withProvider = (content?: Node) =>
    createTestEditor({
      fonts: new DefaultFontProvider({
        default: resource("Inter"),
        resources: [resource("Inter", 700)],
      }),
      ...(content ? { content: content.toJSON() } : {}),
    });

  it("lists every face the document asked for and did not get", () => {
    const editor = withProvider(schema.node("doc", null, [aptos("Retainer")]));
    editor.ensureFullLayout();

    // Not asserting `source`: it depends on whether this environment could
    // install the bytes, and a measurement backend with no way to install a
    // face reports every answer as one it cannot promise.
    expect(editor.fontSubstitutions).toHaveLength(1);
    expect(editor.fontSubstitutions[0]).toMatchObject({
      request: { family: "Aptos" },
      resolved: "Inter",
    });
  });

  it("keeps the same array between layouts, so a selector can compare it", () => {
    // A getter that rebuilt its result would re-render every subscriber on
    // every editor notification.
    const editor = withProvider(schema.node("doc", null, [aptos("Retainer")]));
    editor.ensureFullLayout();

    expect(editor.fontSubstitutions).toBe(editor.fontSubstitutions);
  });

  it("claims nothing when every face was honoured", () => {
    const editor = withProvider();
    editor.ensureFullLayout();

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
    const editor = withProvider();

    expect(editor.getActiveFontFamily().requested).toBe("Arial");
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
