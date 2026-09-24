/**
 * A document is measured in one set of faces, and it is not shown until they
 * are in.
 *
 * Owned faces install one at a time and `canvasResolution` reads the installed
 * set, so a set that became visible as it filled could answer for the faces
 * that had landed and degrade the rest — a line holding regular and bold text
 * measured with the real face for one run and a substitute for the other, its
 * runs placed from both. That is the flash of jumbled text on load.
 */

import { describe, it, expect, vi } from "vitest";
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

/** Regular and bold on one line — where a mix shows up as overlap. */
const MIXED_LINE = {
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

const installedIn = (fonts: string[]): string[] => fonts.filter((f) => f.includes("TestFace"));

/**
 * A measurer whose installs are released one at a time, by id, so the
 * half-installed window is observable rather than a race.
 */
function stagedMeasurer(): {
  measurer: TextMeasurer;
  release: (id: string) => void;
  requested: () => string[];
  installs: string[];
} {
  const open = new Map<string, () => void>();
  const installs: string[] = [];
  const base = createMeasurer();
  const installFont = async (resource: { id: string }): Promise<string> => {
    installs.push(resource.id);
    await new Promise<void>((resolve) => open.set(resource.id, resolve));
    return `TestFace-${resource.id}`;
  };
  const measurer = Object.assign(
    Object.create(Object.getPrototypeOf(base)) as TextMeasurer,
    base,
    { installFont },
  );
  return {
    measurer,
    release: (id) => open.get(id)?.(),
    requested: () => [...open.keys()],
    installs,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

/**
 * Installs are requested one after another, so releasing what is pending
 * reveals the next. Drain until nothing new is asked for.
 */
async function drain(staged: { release: (id: string) => void; requested: () => string[] }): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const pending = staged.requested();
    if (pending.length === 0) break;
    for (const id of pending) staged.release(id);
    await flush();
    if (staged.requested().length === pending.length) break;
  }
  await flush();
}

function editorWith(measurer: TextMeasurer, content: unknown = MIXED_LINE): Editor {
  return new Editor({
    extensions: [StarterKit],
    fonts: new DefaultFontProvider({ default: REGULAR, resources: [BOLD] }),
    textMeasurer: measurer,
    content: content as Record<string, unknown>,
  });
}

describe("installing a document's faces", () => {
  it("does not show a document while its faces are half in", async () => {
    // The shape a shared document loads in: the editor is built on an empty
    // placeholder, the real document arrives, and only then is it shown. Its
    // faces are resolved for the first time in that window, which is where the
    // runs used to take a real face and a substitute on the same line.
    const staged = stagedMeasurer();
    const editor = new Editor({
      extensions: [StarterKit],
      fonts: new DefaultFontProvider({ default: REGULAR, resources: [BOLD] }),
      textMeasurer: staged.measurer,
      startReady: false,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });

    // The placeholder's own face lands first — this is what the browser
    // capture showed: the regular already real, the bold still on its way.
    await flush();
    staged.release(REGULAR.id);
    await flush();

    // The synced document replaces the placeholder, as a collab provider does.
    const state = editor.getState();
    editor.applyTransaction(
      state.tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(MIXED_LINE).content),
    );
    editor.setReady(true);
    await flush();
    editor.ensureFullLayout();

    // A layout measured now would hold the real regular beside a substitute
    // for the bold. What matters is that it is not shown: the editor reports
    // itself unready, and `TileManager.update` paints nothing in that state.
    expect(editor.loadingState).toBe("syncing");

    await drain(staged);
    editor.ensureFullLayout();

    // What is shown is measured in one set, all of it real.
    expect(editor.loadingState).not.toBe("syncing");
    const shown = fontsInLayout(editor);
    expect(installedIn(shown)).toEqual(shown);

    editor.destroy();
  });

  it("stays unready until they are all in, then shows them", async () => {
    const staged = stagedMeasurer();
    const editor = editorWith(staged.measurer);
    expect(editor.loadingState).toBe("syncing");

    staged.release(REGULAR.id);
    await flush();
    // One of two: still nothing honest to show.
    expect(editor.loadingState).toBe("syncing");

    await drain(staged);
    editor.ensureFullLayout();

    expect(editor.loadingState).not.toBe("syncing");
    const fonts = fontsInLayout(editor);
    expect(installedIn(fonts)).toEqual(fonts);

    editor.destroy();
  });

  it("installs each face once, however many passes ask for it", async () => {
    // Two batches run at construction — the document's own, and the one the
    // first layout queues. They must share an install, not repeat it.
    const staged = stagedMeasurer();
    const editor = editorWith(staged.measurer);
    editor.ensureFullLayout();
    await flush();
    await drain(staged);
    editor.ensureFullLayout();

    expect(staged.installs).toEqual([...new Set(staged.installs)]);

    editor.destroy();
  });
});

/**
 * Once it is on screen, a document is never taken away again. A face that
 * turns up later installs in the background and the layout refines; it does
 * not un-ready the editor or throw the layout back to the first chunk.
 */
describe("a face first needed after the document is shown", () => {
  const LONG = {
    type: "doc",
    content: Array.from({ length: 400 }, () => ({
      type: "paragraph",
      content: [{ type: "text", text: "Retainer and fees payable under this agreement." }],
    })),
  };

  it("neither un-readies the editor nor collapses the layout", async () => {
    const staged = stagedMeasurer();
    const editor = editorWith(staged.measurer, LONG);
    editor.ensureFullLayout();
    await flush();
    await drain(staged);
    editor.ensureFullLayout();

    const before = { state: editor.loadingState, pages: editor.layout.pages.length };
    expect(before.state).toBe("ready");
    expect(before.pages).toBeGreaterThan(5);

    // A weight this document has never used, applied to a selection.
    const state = editor.getState();
    editor.applyTransaction(
      state.tr.addMark(1, 40, state.schema.marks["bold"]!.create()),
    );
    editor.ensureFullLayout();
    expect(editor.loadingState).toBe("ready");

    await drain(staged);

    expect({ state: editor.loadingState, pages: editor.layout.pages.length }).toEqual(before);
    expect(editor.layout.isPartial ?? false).toBe(false);

    editor.destroy();
  });
});

/**
 * A host's font problem must not become an editor that cannot paint. Before
 * this gate existed, a provider that never answered degraded to generic and
 * the editor stayed usable; that has to remain true.
 */
describe("a provider that never answers", () => {
  it("shows the document rather than waiting on it forever", async () => {
    vi.useFakeTimers();
    try {
      const provider = new DefaultFontProvider({ default: REGULAR, resources: [BOLD] });
      // Never settles — a fetch that hangs rather than fails.
      provider.prepare = () => new Promise<void>(() => {});

      const staged = stagedMeasurer();
      const editor = new Editor({
        extensions: [StarterKit],
        fonts: provider,
        textMeasurer: staged.measurer,
        content: MIXED_LINE as Record<string, unknown>,
      });

      expect(editor.loadingState).toBe("syncing");

      await vi.advanceTimersByTimeAsync(3_000);

      expect(editor.loadingState).not.toBe("syncing");
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
