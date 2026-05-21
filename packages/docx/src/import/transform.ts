/**
 * Stage 2: transform the normalized `DocxImportModel` into ProseMirror
 * JSON (the shape `ServerEditor.setContent()` accepts).
 *
 * MVP scope: paragraphs and text only. No marks survive yet — extension-
 * dispatched mark mapping lands in the next commit. Headings, lists,
 * images each ship in their own milestone after the extension lane.
 */

import type {
  DocxBlock,
  DocxImportModel,
  DocxInline,
} from "./types";

export interface PmTextNode {
  type: "text";
  text: string;
  marks?: PmMarkJson[];
}

export interface PmMarkJson {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PmBlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNodeJson[];
}

export type PmNodeJson = PmTextNode | PmBlockNode;

export interface PmDocJson {
  type: "doc";
  content: PmBlockNode[];
}

export function transformToProseMirror(model: DocxImportModel): PmDocJson {
  const content: PmBlockNode[] = [];
  for (const block of model.blocks) {
    const node = transformBlock(block);
    if (node) content.push(node);
  }
  // Schemas typically require at least one block in the doc.
  if (content.length === 0) {
    content.push({ type: "paragraph" });
  }
  return { type: "doc", content };
}

function transformBlock(block: DocxBlock): PmBlockNode | null {
  if (block.type === "paragraph") {
    const content = transformInline(block.content);
    const node: PmBlockNode = { type: "paragraph" };
    if (block.attrs.align) node.attrs = { align: block.attrs.align };
    if (content.length > 0) node.content = content;
    return node;
  }
  if (block.type === "horizontalRule") {
    return { type: "horizontalRule" };
  }
  if (block.type === "pageBreak") {
    return { type: "pageBreak" };
  }
  return null;
}

function transformInline(inlines: DocxInline[]): PmNodeJson[] {
  const out: PmNodeJson[] = [];
  for (const item of inlines) {
    if (item.type === "text") {
      // MVP: drop marks. Mark dispatch via extensions lands next.
      out.push({ type: "text", text: item.text });
    } else if (item.type === "hardBreak") {
      out.push({ type: "hardBreak" });
    }
  }
  return out;
}
