/**
 * A document is not shown until the faces it is written in are installed.
 *
 * Installing owned bytes is asynchronous. Laying out before it finishes means
 * measuring against whatever the host substitutes for a family it does not
 * have, and swapping to the real faces afterwards re-breaks every line — which
 * is the flash of jumbled text on load. Waiting is cheaper than showing the
 * wrong thing and correcting it.
 */

import { describe, it, expect } from "vitest";
import { Editor } from "../Editor";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultFontProvider } from "./DefaultFontProvider";
import { createMeasurer } from "../test-utils";
import type { FontResource } from "./types";
import type { TextMeasurer } from "../layout/TextMeasurer";

const face = (id: string, weight: number): FontResource => ({
  id,
  family: "Owned",
  weight,
  style: "normal",
  embedding: { allowed: true, source: "caller" },
  bytes: async () => new ArrayBuffer(8),
});

const REGULAR = face("owned-400", 400);
const BOLD = face("owned-700", 700);

/** Regular and bold on one line — the case that shows a mix as overlap. */
const CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Plain runs beside " },
        { type: "text", text: "a bold run", marks: [{ type: "bold" }] },
        { type: "text", text: " on one line." },
      ],
    },
  ],
};

/** Every font shorthand the current layout measured against. */
function fontsInLayout(editor: Editor): string[] {
  const fonts = new Set<string>();
  for (const page of editor.layout.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const span of line.spans) {
          if (span.kind === "text") fonts.add(span.font);
        }
      }
    }
  }
  return [...fonts];
}

/** A measurer whose installs land only when the test lets them. */
function gatedMeasurer(): { measurer: TextMeasurer; release: () => void } {
  const base = createMeasurer();
  let open = (): void => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let n = 0;
  const installFont = async (): Promise<string> => {
    await gate;
    return `TestFace${n++}`;
  };
  const measurer = Object.assign(
    Object.create(Object.getPrototypeOf(base)) as TextMeasurer,
    base,
    { installFont },
  );
  return { measurer, release: () => open() };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function editorWith(measurer: TextMeasurer): Editor {
  return new Editor({
    extensions: [StarterKit],
    fonts: new DefaultFontProvider({ default: REGULAR, resources: [BOLD] }),
    textMeasurer: measurer,
    content: CONTENT,
  });
}

describe("showing a document written in owned faces", () => {
  it("stays unready until its faces are installed", async () => {
    const { measurer, release } = gatedMeasurer();
    const editor = editorWith(measurer);

    // Nothing has been installed, so there is nothing honest to show yet.
    expect(editor.loadingState).toBe("syncing");

    release();
    await flush();

    expect(editor.loadingState).not.toBe("syncing");
    editor.destroy();
  });

  it("measures the first layout it shows against the real faces", async () => {
    const { measurer, release } = gatedMeasurer();
    const editor = editorWith(measurer);

    release();
    await flush();
    editor.ensureFullLayout();

    // Not one run left against the family the host would have substituted.
    const fonts = fontsInLayout(editor);
    const allInstalled = fonts.length > 0 && fonts.every((f) => f.includes("TestFace"));
    expect({ allInstalled, fonts }).toEqual({ allInstalled: true, fonts });
    editor.destroy();
  });

  it("installs a set all at once, never half of it", async () => {
    // Each install is a separate await, and the resolver reads the set as it
    // is. A set that filled in place would answer for the faces that had
    // landed and degrade the rest, putting two typefaces on one line.
    const { measurer, release } = gatedMeasurer();
    const editor = editorWith(measurer);

    release();
    await flush();
    editor.ensureFullLayout();

    const fonts = fontsInLayout(editor);
    const installed = fonts.filter((f) => f.includes("TestFace"));
    expect(installed.length === 0 || installed.length === fonts.length).toBe(true);
    // Both weights are on that line, so this really did cover a set of two.
    expect(fonts.length).toBeGreaterThan(1);
    editor.destroy();
  });
});
