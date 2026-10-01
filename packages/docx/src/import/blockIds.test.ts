/**
 * An imported document has to be addressable.
 *
 * Every downstream anchor — a section read, a citation, a suggestion, a
 * semantic unit — names a block by `nodeId`. Ids minted per load instead of
 * once at ingestion means two reads of one unchanged document disagree about
 * what its blocks are called.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";

/** Every block in the doc that declares a `nodeId` attr, with its value. */
function blockIds(doc: PmNode): unknown[] {
  const out: unknown[] = [];
  doc.descendants((node) => {
    if (node.isBlock && node.type.spec.attrs && "nodeId" in node.type.spec.attrs) {
      out.push(node.attrs["nodeId"]);
    }
    return true;
  });
  return out;
}

const threeBlocks = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    { type: "paragraph", content: [{ type: "text", text: "First" }] },
    { type: "paragraph", content: [{ type: "text", text: "Second" }] },
  ],
};

async function bytesOf(content: Record<string, unknown>): Promise<Uint8Array> {
  const editor = new ServerEditor();
  editor.setContent(content);
  return exportDocxBytes(editor);
}

describe("importDocx assigns block ids", () => {
  it("gives every block an id, the way an editor session would", async () => {
    const { doc } = await importDocx(new ServerEditor(), await bytesOf(threeBlocks));
    const ids = blockIds(doc);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("gives each block its own id, so one anchor names one block", async () => {
    const { doc } = await importDocx(new ServerEditor(), await bytesOf(threeBlocks));
    const ids = blockIds(doc);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns nothing when the editor's own session would not", async () => {
    // Conditioned on the extension rather than on an option: an editor built
    // without `UniqueId` mints no ids when a person types into it, and an
    // import into that editor has no business minting them either.
    const importer = new ServerEditor({
      extensions: [StarterKit.configure({ uniqueId: false })],
    });
    const { doc } = await importDocx(importer, await bytesOf(threeBlocks));

    expect(blockIds(doc).every((id) => id === null)).toBe(true);
  });
});
