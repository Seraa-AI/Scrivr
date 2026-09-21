/**
 * What the canvas does with a weight or slant no owned face supplies.
 *
 * The strength is unit-tested where it is computed; this is about the painting
 * — that a stand-in is actually drawn, that the context it borrows is handed
 * back, and that a run whose face is real is left alone. A leaked transform
 * here would lean everything drawn after it, including the underlines and
 * highlights the mark decorators paint around this call.
 *
 * Painted through the editor's own block registry, because that is what a real
 * editor does: `renderPage` dispatches every paragraph and heading to
 * `TextBlockStrategy` and only falls back to `drawBlock` for a type nothing
 * registered. A test that omitted the registry would prove the fallback works
 * and say nothing about the path anyone takes.
 */

import { describe, it, expect } from "vitest";
import { createNapiCanvasContext } from "../test/createNapiCanvasContext";
import { createInstallingMeasurer, createTestEditor } from "../test-utils";
import { getSchema } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultFontProvider } from "../fonts/DefaultFontProvider";
import type { FontResource } from "../fonts/types";
import { renderPage } from "./PageRenderer";
import { CharacterMap } from "../layout/CharacterMap";

const schema = getSchema([StarterKit]);

const resource = (family: string, weight = 400, style: "normal" | "italic" = "normal"): FontResource => ({
  id: `${family}-${weight}-${style}`,
  family,
  weight,
  style,
  bytes: () => Promise.resolve(new ArrayBuffer(8)),
});

/** Every context call, in order, so a missing restore is visible. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const real = createNapiCanvasContext();
  const ctx = new Proxy(real as unknown as Record<string, unknown>, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return Reflect.apply(value as (...a: unknown[]) => unknown, target, args);
      };
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value);
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** Lay a styled paragraph out against an inventory, then paint page one. */
async function paintWith(
  resources: readonly FontResource[],
  marks: readonly string[],
): Promise<string[]> {
  const editor = createTestEditor({
    textMeasurer: createInstallingMeasurer(),
    fonts: new DefaultFontProvider({ default: resource("Inter"), resources }),
    content: schema
      .node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("Retainer", marks.map((m) => schema.marks[m]!.create())),
        ]),
      ])
      .toJSON(),
  });
  editor.ensureFullLayout();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  editor.ensureFullLayout();

  const { ctx, calls } = recordingContext();
  const page = editor.layout.pages[0]!;
  renderPage({
    ctx,
    page,
    blockRegistry: editor.blockRegistry,
    pageConfig: editor.layout.pageConfig,
    renderVersion: editor.layout.version,
    currentVersion: () => editor.layout.version,
    dpr: 1,
    measurer: editor.measurer,
    map: new CharacterMap(),
    ...(editor.layout.fontResolutions
      ? { fontResolutions: editor.layout.fontResolutions }
      : {}),
  });
  return calls;
}

const balanced = (calls: string[]) =>
  calls.filter((c) => c === "save").length === calls.filter((c) => c === "restore").length;

describe("painting a face the inventory does not hold", () => {
  it("thickens the run when nothing owns the weight", async () => {
    const calls = await paintWith([], ["bold"]);

    expect(calls).toContain("strokeText");
    expect(balanced(calls)).toBe(true);
  }, 30_000);

  it("leans the run when nothing owns the slant", async () => {
    const calls = await paintWith([], ["italic"]);

    expect(calls).toContain("transform");
    expect(balanced(calls)).toBe(true);
  }, 30_000);

  it("leaves a run alone when the face is real", async () => {
    // The inventory holds the bold, so the heading is set in a designed face
    // and nothing is faked.
    const calls = await paintWith([resource("Inter", 700)], ["bold"]);

    expect(calls).not.toContain("strokeText");
    expect(calls).not.toContain("transform");
  }, 30_000);

  it("hands the context back after leaning it", async () => {
    // A leaked shear would slant every underline, highlight and table rule
    // drawn after this run.
    const calls = await paintWith([], ["italic"]);
    const lastTransform = calls.lastIndexOf("transform");
    const lastRestore = calls.lastIndexOf("restore");

    expect(lastRestore).toBeGreaterThan(lastTransform);
  }, 30_000);
});
