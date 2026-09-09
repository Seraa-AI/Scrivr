/**
 * A document names the fonts it was written in. If this environment cannot
 * draw one, the layout is measured against a face the author never chose and
 * every consumer of that layout silently inherits the discrepancy — so the
 * import says so.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor } from "@scrivr/core";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";
import type { DocxDiagnostic } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";

/** A doc whose runs carry the given font families. */
async function docxNaming(families: string[]): Promise<Uint8Array> {
  const editor = new ServerEditor();
  editor.setContent({
    type: "doc",
    content: families.map((family) => ({
      type: "paragraph",
      content: [
        { type: "text", text: "text", marks: [{ type: "fontFamily", attrs: { family } }] },
      ],
    })),
  });
  return exportDocxBytes(editor);
}

const fontDiagnostics = (diagnostics: DocxDiagnostic[]) =>
  diagnostics.filter((d) => d.code === "unavailable-font");

describe("fonts the environment cannot draw", () => {
  it("reports each family that is unavailable", async () => {
    const bytes = await docxNaming(["Aptos", "Georgia"]);
    const { diagnostics } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: (family) => family !== "Aptos",
    });
    const reported = fontDiagnostics(diagnostics);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.message).toContain("Aptos");
    expect(reported[0]!.level).toBe("warning");
    expect(reported[0]!.markType).toBe("fontFamily");
  });

  it("reports a family once however often it is used", async () => {
    const bytes = await docxNaming(["Aptos", "Aptos", "Aptos"]);
    const { diagnostics } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: () => false,
    });
    expect(fontDiagnostics(diagnostics)).toHaveLength(1);
  });

  it("says nothing when every font is available", async () => {
    const bytes = await docxNaming(["Aptos", "Georgia"]);
    const { diagnostics } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: () => true,
    });
    expect(fontDiagnostics(diagnostics)).toEqual([]);
  });

  it("says nothing where there is no font system to ask", async () => {
    // No `fontAvailability`, and `document` is absent under the node
    // environment — the server cannot know, so it does not guess.
    const bytes = await docxNaming(["Aptos"]);
    const { diagnostics } = await importDocx(new ServerEditor(), bytes);
    expect(fontDiagnostics(diagnostics)).toEqual([]);
  });

  it("does not report a document that names no font", async () => {
    const editor = new ServerEditor({ content: "plain" });
    const bytes = await exportDocxBytes(editor);
    const { diagnostics } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: () => false,
    });
    expect(fontDiagnostics(diagnostics)).toEqual([]);
  });
});

describe("unavailableFonts: \"strip\"", () => {
  /** The families still named anywhere in the doc, marks and attrs alike. */
  function familiesIn(doc: PmNode): string[] {
    const found = new Set<string>();
    doc.descendants((node) => {
      const attr = node.attrs["fontFamily"];
      if (typeof attr === "string" && attr) found.add(attr);
      for (const mark of node.marks) {
        if (mark.type.name === "fontFamily") found.add(String(mark.attrs["family"]));
      }
    });
    return [...found].sort();
  }

  it("removes only the fonts that are unavailable", async () => {
    const bytes = await docxNaming(["Aptos", "Georgia"]);
    const { doc } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: (family) => family !== "Aptos",
      unavailableFonts: "strip",
    });
    expect(familiesIn(doc)).toEqual(["Georgia"]);
  });

  it("keeps them by default", async () => {
    const bytes = await docxNaming(["Aptos", "Georgia"]);
    const { doc } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: (family) => family !== "Aptos",
    });
    expect(familiesIn(doc)).toEqual(["Aptos", "Georgia"]);
  });

  it("preserves the text and every other mark", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "keep me",
              marks: [
                { type: "bold" },
                { type: "italic" },
                { type: "fontFamily", attrs: { family: "Aptos" } },
              ],
            },
          ],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const { doc } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: () => false,
      unavailableFonts: "strip",
    });
    const run = doc.child(0).child(0);
    expect(run.text).toBe("keep me");
    expect(run.marks.map((m) => m.type.name).sort()).toEqual(["bold", "italic"]);
  });

  it("says the font was replaced rather than substituted", async () => {
    const bytes = await docxNaming(["Aptos"]);
    const { diagnostics } = await importDocx(new ServerEditor(), bytes, {
      fontAvailability: () => false,
      unavailableFonts: "strip",
    });
    expect(fontDiagnostics(diagnostics)[0]!.message).toContain("replaced");
  });
});
