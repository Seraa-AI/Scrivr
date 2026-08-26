// @vitest-environment happy-dom
/**
 * Image wrap modes across the full document chain:
 *
 *   editor → DOCX export → DOCX import → clipboard copy → paste back
 *
 * Each leg is a place a wrap mode can silently degrade to "inline", and the
 * legs compose in the real world — a user opens a .docx, then copies a
 * floating image from one part of it to another. The DOCX legs are also
 * covered on their own in import.test.ts; what this adds is the clipboard leg
 * and the composition of all of them.
 *
 * Runs under happy-dom (rather than the package's node default) because the
 * clipboard leg serializes and re-parses through real DOM nodes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AllSelection } from "@scrivr/core/pm";
import type { Node as PMNode } from "@scrivr/core/pm";
import {
  ServerEditor,
  PasteTransformer,
  serializeSelectionToHtml,
  serializeSelectionToText,
} from "@scrivr/core";
import { exportDocxBytes } from "./export/export";
import { importDocx } from "./import/import";

const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const PNG_URL = "https://example.com/x.png";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array(TINY_PNG_BYTES).buffer, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** One image per wrap mode, each with the placement attrs that mode uses. */
const WRAPPED_IMAGES = [
  { wrapMode: "inline" },
  { wrapMode: "square", xAlign: "center" },
  { wrapMode: "top-bottom" },
  { wrapMode: "behind", xAlign: "right" },
  { wrapMode: "front", xAlign: "left" },
] as const;

function docWithWrappedImages(src: string = PNG_URL): Record<string, unknown> {
  return {
    type: "doc",
    content: WRAPPED_IMAGES.map((attrs) => ({
      type: "paragraph",
      content: [
        { type: "text", text: "before " },
        { type: "image", attrs: { src, width: 100, height: 50, ...attrs } },
        { type: "text", text: " after" },
      ],
    })),
  };
}

/** Every image node in document order. */
function images(doc: PMNode): PMNode[] {
  const found: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === "image") found.push(node);
  });
  return found;
}

function wrapModes(doc: PMNode): unknown[] {
  return images(doc).map((n) => n.attrs["wrapMode"]);
}

const EXPECTED_MODES = WRAPPED_IMAGES.map((i) => i.wrapMode);

/** Select everything, then copy the way InputBridge's copy handler does. */
function copyAll(editor: ServerEditor): Record<string, string> {
  const state = editor.getState();
  editor.applyTransaction(state.tr.setSelection(new AllSelection(state.doc)));

  const data: Record<string, string> = {};
  const html = serializeSelectionToHtml(editor.getState(), editor.schema);
  const text = serializeSelectionToText(editor.getState());
  if (html !== null) data["text/html"] = html;
  if (text !== null) data["text/plain"] = text;
  return data;
}

/** Paste clipboard payloads into a fresh, empty editor. */
function pasteIntoEmptyDoc(data: Record<string, string>): PMNode {
  const target = new ServerEditor();
  const transformer = new PasteTransformer(target.schema);
  const tr = transformer.transform(
    { getData: (key: string) => data[key] ?? "" } as unknown as DataTransfer,
    target.getState(),
  );
  expect(tr).not.toBeNull();
  target.applyTransaction(tr!);
  return target.getState().doc;
}

describe("image wrap modes — document chain round-trip", () => {
  it("survives a DOCX export and import", async () => {
    const editor = new ServerEditor();
    editor.setContent(docWithWrappedImages());

    const bytes = await exportDocxBytes(editor);
    const { doc } = await importDocx(new ServerEditor(), bytes);

    expect(wrapModes(doc)).toEqual(EXPECTED_MODES);
  });

  it("survives a clipboard copy and paste", () => {
    const editor = new ServerEditor();
    editor.setContent(docWithWrappedImages());

    const pasted = pasteIntoEmptyDoc(copyAll(editor));

    expect(wrapModes(pasted)).toEqual(EXPECTED_MODES);
  });

  it("preserves placement attrs alongside the wrap mode on copy and paste", () => {
    const editor = new ServerEditor();
    editor.setContent(docWithWrappedImages());

    const pasted = pasteIntoEmptyDoc(copyAll(editor));
    const [, square, , behind] = images(pasted);

    expect(square?.attrs["xAlign"]).toBe("center");
    expect(behind?.attrs["xAlign"]).toBe("right");
    expect(square?.attrs["width"]).toBe(100);
    expect(square?.attrs["height"]).toBe(50);
  });

  it("survives the whole chain: export, import, then copy and paste", async () => {
    const editor = new ServerEditor();
    editor.setContent(docWithWrappedImages());

    const bytes = await exportDocxBytes(editor);
    const imported = new ServerEditor();
    const { doc } = await importDocx(imported, bytes);
    imported.setContent(doc.toJSON());

    const pasted = pasteIntoEmptyDoc(copyAll(imported));

    expect(wrapModes(pasted)).toEqual(EXPECTED_MODES);
  });
});
