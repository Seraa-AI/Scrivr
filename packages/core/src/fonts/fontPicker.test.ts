/**
 * What a font picker is allowed to offer.
 *
 * The FontFamily extension declares its presets in phase 1, before any editor
 * exists, so it cannot know what the editor it ends up in can render. With an
 * inventory in play those presets become five names that all resolve to one
 * typeface — a control that appears to do something and does not.
 */

import { describe, it, expect } from "vitest";
import { createTestEditor } from "../test-utils";
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
