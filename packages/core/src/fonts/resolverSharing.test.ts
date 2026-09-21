import { describe, it, expect } from "vitest";
import { createInstallingMeasurer, createTestEditor } from "../test-utils";
import { getSchema } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultFontProvider } from "../fonts/DefaultFontProvider";

const schema = getSchema([StarterKit]);

describe("the resolver a contributor lays out with", () => {
  it("is the one the page was measured with", () => {
    // A header being edited re-lays itself out. Handed no resolver it measures
    // against the family the document names, and its lines reflow and its
    // weight changes the moment the caret leaves the band.
    const editor = createTestEditor({
      textMeasurer: createInstallingMeasurer(),
      fonts: new DefaultFontProvider({
        default: {
          id: "inter", family: "Inter", weight: 400, style: "normal",
          bytes: async () => new ArrayBuffer(8),
        },
      }),
      content: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Fees")])]).toJSON(),
    });
    editor.ensureFullLayout();

    expect(editor.fontResolver).not.toBeNull();

    // One id space: every answer the page was measured under is resolvable
    // through the resolver a contributor is handed, so a header laid out with
    // it produces spans the page's own table can describe.
    const shared = editor.fontResolver!.table();
    for (const [id, entry] of editor.layout.fontResolutions ?? []) {
      expect(shared.get(id)?.resolved.family).toBe(entry.resolved.family);
    }
    expect(shared.size).toBeGreaterThan(0);
  });

  it("is absent when the editor has no inventory", () => {
    expect(createTestEditor().fontResolver).toBeNull();
  });
});
