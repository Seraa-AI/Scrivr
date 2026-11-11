/**
 * Which files a block needs embedded belongs to its extension. This one is
 * written only against the public surface: a photo block whose bytes live at
 * its `url`, declared on the PDF lane, fetched like an image's `src`.
 */
import { describe, expect, it, vi } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { buildPdf, type ImageBytes } from "../index";
import { block, onePage } from "./fixtures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const Photos = Extension.create({
  name: "photos",
  addNodes() {
    return { photo: { group: "block", atom: true, attrs: { url: { default: "" } }, toDOM: () => ["img"] } };
  },
  addExports() {
    return {
      pdf: {
        nodes: { photo: () => {} },
        embeds: { photo: (node) => (typeof node.attrs["url"] === "string" && node.attrs["url"] !== "" ? node.attrs["url"] : null) },
      },
    };
  },
});

describe("an embedded file from outside core", () => {
  it("is fetched from where its extension says its bytes live", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Photos] });
    const url = "https://example.com/photo.png";
    const photo = editor.schema.nodes["photo"]?.create({ url });
    if (!photo) throw new Error("no photo");
    const resolveImage = vi.fn(async (): Promise<ImageBytes> => ({ bytes: PNG, format: "png" }));

    await buildPdf(onePage([{ ...block("paragraph", []), node: photo, blockType: "photo" }]), editor, { resolveImage });
    expect(resolveImage).toHaveBeenCalledWith(url);
  });
});
