/**
 * Which pasted files become which nodes belongs to the extension that owns the
 * node. This one is written only against `@scrivr/core`'s public surface: a
 * photo node that takes pasted PNG files, with no engine change.
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { Document, Extension, ExtensionManager, Paragraph, PasteTransformer, StarterKit, normalizeDocument } from "../index";

const Photos = Extension.create({
  name: "photos",
  addNodes() {
    return {
      photo: {
        group: "inline",
        inline: true,
        atom: true,
        attrs: { url: { default: "" }, w: { default: 0 }, h: { default: 0 }, waiting: { default: null } },
        toDOM: () => ["img"],
      },
    };
  },
  addPasteFiles() {
    return {
      photo: {
        accepts: (file) => file.type === "image/png",
        pending: (id) => ({ waiting: id }),
        pendingIdOf: (node) => (typeof node.attrs["waiting"] === "string" ? node.attrs["waiting"] : null),
        resolved: ({ src, width, height }) => ({ url: src, w: width, h: height, waiting: null }),
      },
    };
  },
});

const manager = new ExtensionManager([Document, Paragraph, Photos]);

const photosIn = (doc: Node) => {
  const found: Node[] = [];
  doc.descendants((node) => {
    if (node.type.name === "photo") found.push(node);
  });
  return found;
};

describe("pasted files from outside core", () => {
  it("become the node whose extension takes them, through its placeholder", async () => {
    const transformer = new PasteTransformer(manager.schema, {}, {
      pasteFiles: manager.buildPasteFiles(),
      uploadImage: async () => "https://example.com/shot.png",
    });
    const state = EditorState.create({ schema: manager.schema });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
    const jpeg = new File([new Uint8Array([0xff, 0xd8])], "shot.jpg", { type: "image/jpeg" });
    const data = new DataTransfer();
    for (const f of [png, jpeg]) data.items.add(f);

    const pending = transformer.prepareImagePaste(data, state);
    if (!pending) throw new Error("no paste");
    const placed = state.apply(pending.insert);
    expect(photosIn(placed.doc).map((photo) => typeof photo.attrs["waiting"])).toEqual(["string"]);

    const resolved = await pending.resolve(() => placed);
    if (!resolved) throw new Error("no resolution");
    expect(photosIn(placed.apply(resolved).doc).map((photo) => photo.attrs["url"])).toEqual(["https://example.com/shot.png"]);
  });

  it("go to the extension registered later, when two take the same file", () => {
    const withImage = new ExtensionManager([StarterKit, Photos]);
    const transformer = new PasteTransformer(withImage.schema, {}, { pasteFiles: withImage.buildPasteFiles() });
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([0x89])], "shot.png", { type: "image/png" }));
    const pending = transformer.prepareImagePaste(data, EditorState.create({ schema: withImage.schema }));
    if (!pending) throw new Error("no paste");
    const placed = EditorState.create({ schema: withImage.schema }).apply(pending.insert);
    expect(photosIn(placed.doc)).toHaveLength(1);
  });

  it("leave no placeholder behind when a document is loaded with one", () => {
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "photo", attrs: { waiting: "orphan" } }] }] };
    const result = normalizeDocument(json, { schema: manager.schema, pasteFiles: manager.buildPasteFiles() });
    expect(photosIn(result.doc)).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain("placeholders-dropped");
  });
});
