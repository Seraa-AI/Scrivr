/**
 * Pasted markdown becomes the nodes and marks extensions declare markdown
 * tokens for. What no extension declares stays the text it was.
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { Document, Paragraph, StarterKit, type Extension } from "../index";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { PasteTransformer } from "./PasteTransformer";

function paste(extensions: Extension[], text: string): Node {
  const manager = new ExtensionManager(extensions);
  const state = EditorState.create({ schema: manager.schema });
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  const tr = new PasteTransformer(manager.schema, manager.buildMarkdownParserTokens()).transform(clipboardData, state);
  if (!tr) throw new Error("paste produced no transaction");
  return tr.doc;
}

const blocksOf = (doc: Node): { type: string; text: string }[] => {
  const blocks: { type: string; text: string }[] = [];
  doc.forEach((block) => blocks.push({ type: block.type.name, text: block.textContent }));
  return blocks.filter((block) => block.text !== "");
};

describe("pasting markdown", () => {
  it("strikes through ~~text~~, as the markdown export writes it", () => {
    const doc = paste([StarterKit], "# Notes\n\n~~gone~~ kept");
    const struck: string[] = [];
    doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "strikethrough")) struck.push(node.text ?? "");
    });
    expect(struck).toEqual(["gone"]);
  });

  it("keeps a construct no extension declares as the text it was", () => {
    const table = ["# Equipment", "", "| Item | Provided |", "|------|----------|", "| Monitor | On request |"];
    expect(blocksOf(paste([StarterKit], table.join("\n")))).toEqual(
      table.filter((line) => line !== "").map((text) => ({ type: "paragraph", text })),
    );
  });

  it("keeps inline code, which no extension declares, as the text it was", () => {
    expect(blocksOf(paste([StarterKit], "# Setup\n\nRun `npm i` now"))).toEqual([
      { type: "heading", text: "Setup" },
      { type: "paragraph", text: "Run `npm i` now" },
    ]);
  });

  it("pastes the text as it is when no extension declares markdown tokens", () => {
    expect(blocksOf(paste([Document, Paragraph], "# Title\nbody"))).toEqual([
      { type: "paragraph", text: "# Title" },
      { type: "paragraph", text: "body" },
    ]);
  });
});
