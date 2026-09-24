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
  const measurer = createMeasurer();
  measurer.installFont = async (resource: FontResource): Promise<string> => {
    installs.push(resource.id);
    await new Promise<void>((resolve) => open.set(resource.id, resolve));
    return `TestFace-${resource.id}`;
  };
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
    // Flush first: an install is only requested once preparation has awaited
    // the provider, so checking before that reads an empty set and gives up.
    await flush();
    const pending = staged.requested();
    if (pending.length === 0) break;
    for (const id of pending) staged.release(id);
    await flush();
    // Identities, not counts: one install finishing as another starts is
    // progress, and comparing lengths would read it as a stall.
    const still = staged.requested();
    if (still.length === pending.length && still.every((id) => pending.includes(id))) break;
  }
  await flush();
}

function editorWith(measurer: TextMeasurer, content: Record<string, unknown> = MIXED_LINE): Editor {
  return new Editor({
    extensions: [StarterKit],
    fonts: new DefaultFontProvider({ default: REGULAR, resources: [BOLD] }),
    textMeasurer: measurer,
    content,
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

const LONG = {
  type: "doc",
  content: Array.from({ length: 400 }, () => ({
    type: "paragraph",
    content: [{ type: "text", text: "Retainer and fees payable under this agreement." }],
  })),
};

/**
 * Once it is on screen, a document is never taken away again. A face that
 * turns up later installs in the background and the layout refines; it does
 * not un-ready the editor or throw the layout back to the first chunk.
 */
describe("a face first needed after the document is shown", () => {
  it("installs it in the background without disturbing the layout", async () => {
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
    // And it really did install — otherwise this passes by doing nothing.
    expect(staged.installs).toContain(BOLD.id);

    editor.destroy();
  });

  it("is not taken away again when the caller re-opens its own gate", async () => {
    // A reconnect cycles `setReady`. The document is already on screen, so it
    // must stay on screen — this is the case that used to put a live document
    // behind a loading state and rebuild its layout from the first chunk.
    const staged = stagedMeasurer();
    const editor = editorWith(staged.measurer, LONG);
    editor.ensureFullLayout();
    await drain(staged);
    editor.ensureFullLayout();
    const before = { state: editor.loadingState, pages: editor.layout.pages.length };
    expect(before.state).toBe("ready");

    // A weight the document has never used, then a reconnect.
    const state = editor.getState();
    editor.applyTransaction(state.tr.addMark(1, 40, state.schema.marks["bold"]!.create()));
    editor.setReady(false);
    editor.setReady(true);

    // `setReady(true)` re-chunks the layout, which is its own documented job.
    // What must not happen is the font gate closing over a live document.
    expect(editor.loadingState).not.toBe("syncing");

    await drain(staged);
    editor.ensureFullLayout();
    expect({ state: editor.loadingState, pages: editor.layout.pages.length }).toEqual(before);

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
        content: MIXED_LINE,
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

/**
 * The wait is bounded, and the faces still arrive. Showing the document
 * against a substitute is the bound doing its job; leaving it there once the
 * real faces land is not — the re-break would surface later, mid-edit.
 */
describe("faces that land after the wait is over", () => {
  it("are painted without waiting for an unrelated edit", async () => {
    vi.useFakeTimers();
    try {
      const staged = stagedMeasurer();
      const editor = editorWith(staged.measurer);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(editor.loadingState).not.toBe("syncing");
      // Shown against the substitute: the budget ran out, which is allowed.
      expect(installedIn(fontsInLayout(editor))).toEqual([]);

      for (const id of staged.requested()) staged.release(id);
      await vi.advanceTimersByTimeAsync(50);

      // No edit, no scroll — the faces alone bring the document to its own.
      const fonts = fontsInLayout(editor);
      expect(installedIn(fonts)).toEqual(fonts);
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A document can reach the screen without the gate ever closing — its faces
 * were already there, or nobody owns them. It is still on screen, so a later
 * `setReady(true)` must not gate it.
 */
describe("a document shown without ever waiting", () => {
  /** Owns the bold face only; plain text resolves to a host family. */
  function partialProvider(): DefaultFontProvider {
    const provider = new DefaultFontProvider({ default: REGULAR, resources: [BOLD] });
    const inner = provider.resolve.bind(provider);
    provider.resolve = (request, constraints) => {
      const answer = inner(request, constraints);
      if (request.weight >= 700) return answer;
      // Nothing owned for this one: the host will decide, as a system family.
      const { resource: _dropped, ...rest } = answer;
      return { ...rest, resolved: { ...answer.resolved, source: "generic", portable: false } };
    };
    return provider;
  }

  it("is not gated by a later setReady", async () => {
    const staged = stagedMeasurer();
    const editor = new Editor({
      extensions: [StarterKit],
      fonts: partialProvider(),
      textMeasurer: staged.measurer,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] },
    });
    editor.ensureFullLayout();
    await drain(staged);
    // Nothing was owned for this document, so it was shown without waiting.
    expect(editor.loadingState).not.toBe("syncing");

    // Now a weight that *is* owned, then a reconnect.
    const state = editor.getState();
    editor.applyTransaction(state.tr.addMark(1, 5, state.schema.marks["bold"]!.create()));
    editor.ensureFullLayout();
    editor.setReady(false);
    editor.setReady(true);

    expect(editor.loadingState).not.toBe("syncing");

    editor.destroy();
  });
});

/**
 * A provider that rejects is an anticipated case, and it must not cost the
 * whole budget. The rejection happens while a second document is queued
 * behind it, which is where a dropped request set used to leave the gate shut
 * with nothing in flight to reopen it.
 */
describe("a provider that rejects while a document is queued", () => {
  it("still prepares the queued document, without burning the budget", async () => {
    vi.useFakeTimers();
    try {
      const staged = stagedMeasurer();
      const provider = new DefaultFontProvider({ default: REGULAR, resources: [BOLD] });
      const inner = provider.prepare.bind(provider);
      let first = true;
      provider.prepare = async (requests, constraints) => {
        if (first) {
          first = false;
          throw new Error("catalogue unreachable");
        }
        return inner(requests, constraints);
      };

      const editor = new Editor({
        extensions: [StarterKit],
        fonts: provider,
        textMeasurer: staged.measurer,
        startReady: false,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      });

      // The synced document arrives while the first pass is still in flight.
      const state = editor.getState();
      editor.applyTransaction(
        state.tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(MIXED_LINE).content),
      );
      editor.setReady(true);

      await vi.advanceTimersByTimeAsync(10);
      for (let i = 0; i < 6; i++) {
        for (const id of staged.requested()) staged.release(id);
        await vi.advanceTimersByTimeAsync(10);
      }

      // Well inside the two-second budget: the queued document was prepared
      // rather than dropped, so nothing is waiting on the timer.
      expect(editor.loadingState).not.toBe("syncing");
      expect(staged.installs.length).toBeGreaterThan(0);

      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
