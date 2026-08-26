import { describe, it, expect, afterEach, vi } from "vitest";
import { AllSelection, EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { PasteTransformer, fitPastedImage } from "./PasteTransformer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const schema = manager.schema;
  const state = EditorState.create({ schema, plugins: manager.buildPlugins() });
  return { schema, state };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function file(name: string, type: string, bytes = PNG_BYTES): File {
  return new File([bytes], name, { type });
}

/** A DataTransfer stub carrying files, and optionally text formats too. */
function clipboard(
  files: File[],
  data: Record<string, string> = {},
): DataTransfer {
  return {
    files,
    getData: (key: string) => data[key] ?? "",
  } as unknown as DataTransfer;
}

function images(doc: PMNode): PMNode[] {
  const found: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === "image") found.push(node);
  });
  return found;
}

// ── Sizing ────────────────────────────────────────────────────────────────────

describe("fitPastedImage", () => {
  it("keeps images that already fit at their natural size", () => {
    expect(fitPastedImage(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it("scales oversized images down proportionally", () => {
    // A 1200×600 screenshot is wider than the content column; halving it to
    // 600 wide must halve the height too, or the image is distorted.
    expect(fitPastedImage(1200, 600)).toEqual({ width: 600, height: 300 });
  });

  it("preserves the aspect ratio of a tall image", () => {
    const { width, height } = fitPastedImage(1800, 2400);
    expect(width).toBe(600);
    expect(height).toBe(800);
  });

  it("falls back to the default box for unusable dimensions", () => {
    expect(fitPastedImage(0, 0)).toEqual({ width: 200, height: 200 });
    expect(fitPastedImage(Number.NaN, 100)).toEqual({ width: 200, height: 200 });
  });
});

// ── Image files on the clipboard ──────────────────────────────────────────────

describe("pasting an image file", () => {
  it("resolves the reserved image without touching a later selection", async () => {
    class FailingDecoder {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingDecoder);

    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema, [], {}, {
      uploadImage: async () => "https://cdn.example.com/uploaded.png",
    });
    const pending = transformer.prepareImagePaste(
      clipboard([file("shot.png", "image/png")]),
      state,
    );
    expect(pending).not.toBeNull();

    let current = state.apply(pending!.insert);
    current = current.apply(current.tr.insertText("keep"));
    current = current.apply(current.tr.setSelection(new AllSelection(current.doc)));

    const resolved = await pending!.resolve(() => current);
    expect(resolved).not.toBeNull();
    current = current.apply(resolved!);

    expect(current.doc.textContent).toBe("keep");
    const [img] = images(current.doc);
    expect(img!.attrs["src"]).toBe("https://cdn.example.com/uploaded.png");
    expect(img!.attrs["pendingPasteId"]).toBeNull();
    vi.unstubAllGlobals();
  });

  it("inserts an image node with an inline data URL by default", async () => {
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("shot.png", "image/png")]),
      () => state,
    );
    expect(tr).not.toBeNull();

    const [img] = images(state.apply(tr!).doc);
    expect(img).toBeDefined();
    expect(String(img!.attrs["src"])).toMatch(/^data:image\/png;base64,/);
  });

  it("uses a supplied uploader's URL instead of embedding the bytes", async () => {
    const { schema, state } = makeContext();
    const uploaded: File[] = [];
    const transformer = new PasteTransformer(schema, [], {}, {
      uploadImage: async (f) => {
        uploaded.push(f);
        return "https://cdn.example.com/uploaded.png";
      },
    });

    const tr = await transformer.transformFiles(
      clipboard([file("shot.png", "image/png")]),
      () => state,
    );

    const [img] = images(state.apply(tr!).doc);
    expect(img!.attrs["src"]).toBe("https://cdn.example.com/uploaded.png");
    expect(uploaded).toHaveLength(1);
  });

  it("falls back to no insertion when the uploader fails", async () => {
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema, [], {}, {
      uploadImage: async () => {
        throw new Error("network down");
      },
    });

    const tr = await transformer.transformFiles(
      clipboard([file("shot.png", "image/png")]),
      () => state,
    );
    expect(tr).toBeNull();
  });

  it("rejects an SVG file — it can carry script, unlike raster bytes", async () => {
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("evil.svg", "image/svg+xml")]),
      () => state,
    );
    expect(tr).toBeNull();
  });

  it("rejects a src the uploader returns that is not a safe URL", async () => {
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema, [], {}, {
      uploadImage: async () => "javascript:alert(1)",
    });

    const tr = await transformer.transformFiles(
      clipboard([file("shot.png", "image/png")]),
      () => state,
    );
    expect(tr).toBeNull();
  });

  it("ignores non-image files", async () => {
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("notes.txt", "text/plain")]),
      () => state,
    );
    expect(tr).toBeNull();
  });

  it("inserts every image when several are pasted at once", async () => {
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("a.png", "image/png"), file("b.png", "image/png")]),
      () => state,
    );

    expect(images(state.apply(tr!).doc)).toHaveLength(2);
  });

  it("ignores the file when the clipboard also carries HTML", async () => {
    // Copying an image from a web page puts both an <img> and the bytes on the
    // clipboard. The HTML keeps the original URL, so the document stays small —
    // embedding the bytes as well would insert the image twice.
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("a.png", "image/png")], {
        "text/html": `<img src="https://example.com/a.png">`,
      }),
      () => state,
    );
    expect(tr).toBeNull();
  });
});

// ── Measuring the decoded image ───────────────────────────────────────────────

/**
 * `measureImage` needs a decoder. happy-dom constructs an `Image` but never
 * fires load or error, so without a stub every test above falls through the
 * decode timeout to the default box — the sizing path would never actually run.
 * These stub the decoder to exercise it.
 */
describe("pasted image sizing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** An Image whose load/error fires on the next tick, as a browser's would. */
  function stubDecoder(
    outcome: { naturalWidth: number; naturalHeight: number } | "error",
  ): void {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = outcome === "error" ? 0 : outcome.naturalWidth;
      naturalHeight = outcome === "error" ? 0 : outcome.naturalHeight;
      set src(_value: string) {
        queueMicrotask(() => {
          if (outcome === "error") this.onerror?.();
          else this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", FakeImage);
  }

  it("inserts a decoded image at its natural size", async () => {
    stubDecoder({ naturalWidth: 320, naturalHeight: 240 });
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("shot.png", "image/png")]),
      () => state,
    );

    const [img] = images(state.apply(tr!).doc);
    expect(img!.attrs["width"]).toBe(320);
    expect(img!.attrs["height"]).toBe(240);
  });

  it("scales an oversized screenshot down to fit the page", async () => {
    stubDecoder({ naturalWidth: 2560, naturalHeight: 1440 });
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("shot.png", "image/png")]),
      () => state,
    );

    const [img] = images(state.apply(tr!).doc);
    expect(img!.attrs["width"]).toBe(600);
    // Aspect ratio held: 1440 * (600/2560) = 337.5 → 338.
    expect(img!.attrs["height"]).toBe(338);
  });

  it("falls back to the default box when the image cannot be decoded", async () => {
    stubDecoder("error");
    const { schema, state } = makeContext();
    const transformer = new PasteTransformer(schema);

    const tr = await transformer.transformFiles(
      clipboard([file("broken.png", "image/png")]),
      () => state,
    );

    const [img] = images(state.apply(tr!).doc);
    expect(img!.attrs["width"]).toBe(200);
    expect(img!.attrs["height"]).toBe(200);
  });
});
