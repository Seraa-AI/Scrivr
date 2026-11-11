/**
 * Completing fields on a sealed revision. A field's value never enters the
 * document: the host captures it — signature pad, consent, authentication —
 * and hands it back to be shown over the page. The document stays exactly
 * what was sealed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { StarterKit, type PagePoint } from "@scrivr/core";
import { ViewEditorDouble } from "../__tests__/viewEditorDouble";
import { FieldCompletion, setFieldValue, type FieldValue, type SealedField } from "../index";

const signHere: SealedField = {
  id: "f-client",
  role: "client-authorized-signatory",
  kind: "signature",
  required: true,
  page: 2,
  rect: { x: 100, y: 600, width: 200, height: 50 },
};
const witness: SealedField = {
  id: "f-witness",
  role: "witness",
  kind: "signature",
  required: true,
  page: 2,
  rect: { x: 400, y: 600, width: 200, height: 50 },
};

const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Terms" }] }] };
const signature: FieldValue = { kind: "text", text: "Ada Lovelace" };

let editor: ViewEditorDouble | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function viewer(onFieldRequest: (field: SealedField) => Promise<FieldValue | null>) {
  editor = new ViewEditorDouble({
    extensions: [
      StarterKit,
      FieldCompletion.configure({
        fields: [signHere, witness],
        completable: [signHere.id],
        values: {},
        onFieldRequest,
      }),
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
