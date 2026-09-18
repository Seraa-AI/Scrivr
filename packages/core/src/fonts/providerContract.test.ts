/**
 * What the engine may assume about a provider's answers.
 *
 * `FontProvider` is an extension point, so the editor has to work with any
 * implementation the interface permits — including one that builds its
 * resolution fresh on every call, which is the natural shape for a provider
 * backed by a catalogue rather than by a fixed list. Identity of the returned
 * object is not part of the contract; `FontResource.id` is.
 */

import { describe, it, expect } from "vitest";
import { createInstallingMeasurer, createTestEditor } from "../test-utils";
import { getSchema } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import type { FontProvider, FontRequest, FontResolution } from "./types";

const schema = getSchema([StarterKit]);

/** Never returns the same object twice, which the interface allows. */
function freshEachCall(): { provider: FontProvider; installs: () => number } {
  let installs = 0;
  const provider: FontProvider = {
    defaultRequest: () => ({ family: "Inter", weight: 400, style: "normal", size: 14 }),
    prepare: async () => {},
    resolve: (request: FontRequest): FontResolution => ({
      request,
      resolved: { family: "Inter", source: "default", portable: true },
      resource: {
        id: "inter-400",
        family: "Inter",
        weight: 400,
        style: "normal",
        bytes: async () => {
          installs++;
          return new ArrayBuffer(8);
        },
      },
    }),
  };
  return { provider, installs: () => installs };
}

const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [schema.text("Retainer and fees")]),
]);

describe("a provider that answers with a new object each time", () => {
  it("installs its bytes once, not once per layout", async () => {
    const { provider, installs } = freshEachCall();
    const editor = createTestEditor({
      textMeasurer: createInstallingMeasurer(),
      fonts: provider,
      content: doc.toJSON(),
    });
    editor.ensureFullLayout();
    for (let i = 0; i < 40; i++) await Promise.resolve();

    const afterFirst = installs();
    for (let i = 0; i < 8; i++) {
      const state = editor.getState();
      editor.applyTransaction(state.tr.insertText("x", 2));
      editor.ensureFullLayout();
      for (let k = 0; k < 20; k++) await Promise.resolve();
    }

    // Keyed on the resource id, so eight more layouts acquire nothing new.
    expect(installs()).toBe(afterFirst);
  }, 30_000);

  it("measures in the face it installed", async () => {
    const { provider } = freshEachCall();
    const editor = createTestEditor({
      textMeasurer: createInstallingMeasurer(),
      fonts: provider,
      content: doc.toJSON(),
    });
    editor.ensureFullLayout();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    editor.ensureFullLayout();

    // Identity-keyed caches would never find the install, leaving every span
    // measured against whatever the host makes of the family name.
    const span = editor.layout.pages[0]?.blocks[0]?.lines[0]?.spans[0];
    expect(span?.kind === "text" && span.font).toContain("TestFace");
    expect(editor.fontSubstitutions[0]?.resolved.family).toBe("Inter");
  }, 30_000);
});
