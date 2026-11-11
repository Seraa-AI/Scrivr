/**
 * Completing fields on a sealed revision. A field's value never enters the
 * document: the host captures it — signature pad, consent, authentication —
 * and hands it back to be shown over the page. The document stays exactly
 * what was sealed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field, StarterKit, type PagePoint, type SignerFieldDescriptor } from "@scrivr/core";
import { ViewEditorDouble } from "../__tests__/viewEditorDouble";
import { FieldCompletion, setFieldValue, type FieldValue } from "../index";

const signHere: SignerFieldDescriptor = { id: "f-client", role: "client-authorized-signatory", kind: "signature", required: true, options: [] };
const witness: SignerFieldDescriptor = { id: "f-witness", role: "witness", kind: "signature", required: true, options: [] };

const fieldNode = (field: SignerFieldDescriptor) => ({
  type: "field",
  attrs: { nodeId: field.id, kind: field.kind, fill: "signer", role: field.role, required: field.required },
});
const content = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Terms" }] },
    { type: "paragraph", content: [fieldNode(signHere), { type: "text", text: " " }, fieldNode(witness)] },
  ],
};
const signature: FieldValue = { kind: "text", text: "Ada Lovelace" };

/** Where each field's box was laid out, as the mounted editor would report it. */
const PAGE_ON_SCREEN = { screenLeft: 40, screenTop: 1000 };
const BOXES: Record<string, { page: number; x: number; y: number; width: number; height: number }> = {
  "f-client": { page: 2, x: 100, y: 600, width: 180, height: 44 },
  "f-witness": { page: 2, x: 400, y: 600, width: 180, height: 44 },
};

/** A DOMRect's shape — the node test environment has no DOMRect. */
const viewportRect = (x: number, y: number, width: number, height: number): DOMRect => ({
  x,
  y,
  width,
  height,
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
  toJSON: () => ({}),
});

class LaidOutViewer extends ViewEditorDouble {
  override getNodeViewportRects(docPos: number): DOMRect[] {
    const id = this.getState().doc.nodeAt(docPos)?.attrs["nodeId"];
    const box = typeof id === "string" ? BOXES[id] : undefined;
    return box ? [viewportRect(PAGE_ON_SCREEN.screenLeft + box.x, PAGE_ON_SCREEN.screenTop + box.y, box.width, box.height)] : [];
  }
  override getPageScreenPosition(page: number) {
    return page === 2 ? PAGE_ON_SCREEN : { screenLeft: 40, screenTop: 5000 };
  }
}

let editor: LaidOutViewer | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function viewer(onFieldRequest: (field: SignerFieldDescriptor) => Promise<FieldValue | null>) {
  editor = new LaidOutViewer({
    extensions: [
      StarterKit,
      Field,
      FieldCompletion.configure({ fields: [signHere, witness], completable: [signHere.id], values: {}, onFieldRequest }),
    ],
    content,
    sealed: true,
  });
  editor.mountView();
  return editor;
}

const point = (page: number, x: number, y: number): PagePoint => ({ page, x, y, region: "content" });
const press = (e: ViewEditorDouble, at: PagePoint) => e.emit("press", { point: at, clickCount: 1 });

describe("FieldCompletion", () => {
  it("paints over the page", () => {
    expect(viewer(async () => null).painters).toHaveLength(1);
  });

  it("asks the host for a value when the viewer presses a field they may complete", () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);

    press(e, point(2, 150, 620));

    expect(request).toHaveBeenCalledWith(signHere);
  });

  it("ignores a press on someone else's field, or on the same spot of another page", () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);

    press(e, point(2, 450, 620));
    press(e, point(1, 150, 620));

    expect(request).not.toHaveBeenCalled();
  });

  it("shows the value the host returns, without touching the sealed document", async () => {
    const e = viewer(async () => signature);
    const redraw = vi.spyOn(e, "redraw");
    const before = e.getState().doc;

    press(e, point(2, 150, 620));
    await flush();

    expect(redraw).toHaveBeenCalled();
    expect(e.getState().doc).toBe(before);
  });

  it("treats a completed field as done", async () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);

    press(e, point(2, 150, 620));
    await flush();
    press(e, point(2, 150, 620));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("asks once while the host is still capturing", () => {
    const request = vi.fn(() => new Promise<FieldValue | null>(() => {}));
    const e = viewer(request);

    press(e, point(2, 150, 620));
    press(e, point(2, 150, 620));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("leaves the field open when the host declines or fails", async () => {
    let answer: () => Promise<FieldValue | null> = async () => null;
    const request = vi.fn(() => answer());
    const e = viewer(request);

    press(e, point(2, 150, 620));
    await flush();
    answer = () => Promise.reject(new Error("consent withdrawn"));
    press(e, point(2, 150, 620));
    await flush();
    answer = async () => signature;
    press(e, point(2, 150, 620));

    expect(request).toHaveBeenCalledTimes(3);
  });

  it("shows a value another participant completed, given by the host", () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);
    const redraw = vi.spyOn(e, "redraw");

    setFieldValue(e, signHere.id, signature);
    press(e, point(2, 150, 620));

    expect(redraw).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
