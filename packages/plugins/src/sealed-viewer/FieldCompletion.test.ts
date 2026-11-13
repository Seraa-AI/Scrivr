/**
 * Completing fields on a sealed revision. A field's value never enters the
 * document: the host captures it — signature pad, consent, authentication —
 * and hands it back for `Field` to hold beside the document. The document
 * stays exactly what was sealed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CharacterMap,
  Field,
  StarterKit,
  defaultPageConfig,
  fieldRoleColor,
  fieldValues,
  setFieldValue,
  type PagePoint,
  type SignerFieldDescriptor,
} from "@scrivr/core";
import { ViewEditorDouble } from "../__tests__/viewEditorDouble";
import { FieldCompletion, moveFieldFocus, requestField, type FieldValue, type SigningFieldDrawing } from "../index";

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
      FieldCompletion.configure({ fields: [signHere, witness], completable: [signHere.id], onFieldRequest }),
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
    // Field's own painter, and the viewer's.
    expect(viewer(async () => null).painters).toHaveLength(2);
  });

  it("asks the host for a value when the viewer presses a field they may complete", () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);

    press(e, point(2, 150, 620));

    expect(request).toHaveBeenCalledWith(signHere, undefined);
  });

  it("ignores a press on someone else's field, or on the same spot of another page", () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);

    press(e, point(2, 450, 620));
    press(e, point(1, 150, 620));

    expect(request).not.toHaveBeenCalled();
  });

  it("gives the field the value the host returns, without touching the sealed document", async () => {
    const e = viewer(async () => signature);
    const before = e.getState().doc;

    press(e, point(2, 150, 620));
    await flush();

    expect(fieldValues(e.getState())[signHere.id]).toEqual(signature);
    expect(e.getState().doc).toBe(before);
  });

  it("reopens a completed field with its value, and keeps that value when the viewer cancels", async () => {
    let answer: FieldValue | null = signature;
    const request = vi.fn(async (_field: SignerFieldDescriptor, _current?: FieldValue) => answer);
    const e = viewer(request);

    press(e, point(2, 150, 620));
    await flush();
    answer = null;
    press(e, point(2, 150, 620));
    await flush();
    press(e, point(2, 150, 620));

    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1]![1]).toEqual(signature);
    // Cancelling the second request kept the value the third is handed.
    expect(request.mock.calls[2]![1]).toEqual(signature);
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

  it("leaves the field open when the host's request throws before it can answer", async () => {
    let answer: () => Promise<FieldValue | null> = () => {
      throw new Error("no signature pad");
    };
    const request = vi.fn(() => answer());
    const e = viewer(request);

    press(e, point(2, 150, 620));
    await flush();
    answer = async () => signature;
    press(e, point(2, 150, 620));

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("tells the host when its request failed, so it can say so to the signer", async () => {
    const failure = new Error("pad unavailable");
    const onFieldRequestError = vi.fn();
    editor = new LaidOutViewer({
      extensions: [
        StarterKit,
        Field,
        FieldCompletion.configure({
          fields: [signHere, witness],
          completable: [signHere.id],
          onFieldRequest: () => Promise.reject(failure),
          onFieldRequestError,
        }),
      ],
      content,
      sealed: true,
    });
    editor.mountView();

    press(editor, point(2, 150, 620));
    await flush();

    expect(onFieldRequestError).toHaveBeenCalledWith(signHere, failure);
  });

  it("shows a value another participant completed, given by the host", () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);

    expect(setFieldValue(e, signHere.id, signature)).toBe(true);
    press(e, point(2, 150, 620));

    // Still this viewer's to change: pressing it hands the host what is there.
    expect(request).toHaveBeenCalledWith(signHere, signature);
  });
});

// Positions in `content`: the viewer's field at 8, the witness's at 10.
describe("FieldCompletion — pointing and the keyboard", () => {
  it("shows a hand over a field the viewer may complete, and an arrow over someone else's", () => {
    const e = viewer(async () => null);

    expect(e.cursorAt(8)).toBe("pointer");
    expect(e.cursorAt(10)).toBe("default");
    expect(e.cursorAt(null)).toBeNull();
  });

  it("opens a field a host asks for — from a list of fields, or a Next button — scrolled into view", () => {
    const request = vi.fn(async () => signature);
    const e = viewer(request);

    expect(requestField(e, signHere.id)).toBe(true);
    expect(request).toHaveBeenCalledWith(signHere, undefined);
    expect(e.scrolledTo).toEqual([{ from: 8, to: 9 }]);
    expect(requestField(e, witness.id)).toBe(false);
  });

  it("moves between the viewer's own fields, in reading order, with Tab and Shift+Tab, and lets focus go at either end", () => {
    const e = viewer(async () => null);

    expect(moveFieldFocus(e, 1)).toBe(signHere.id);
    // Past the viewer's last field focus leaves the page, as Tab leaves a form —
    // it never lands on the witness's field, and never traps the keyboard.
    expect(moveFieldFocus(e, 1)).toBeNull();
    expect(moveFieldFocus(e, -1)).toBe(signHere.id);
    expect(moveFieldFocus(e, -1)).toBeNull();
  });

  it("lets keyboard focus go when the viewer presses elsewhere on the page", () => {
    const e = viewer(async () => null);
    moveFieldFocus(e, 1);

    press(e, point(2, 20, 20));

    // Focus starts over: the next Tab lands on the viewer's first field again.
    expect(moveFieldFocus(e, 1)).toBe(signHere.id);
  });
});

/** A context that records the text drawn on it and accepts every other call. */
function recordingContext(drawn: string[]): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  const isContext = (value: unknown): value is CanvasRenderingContext2D => typeof value === "object" && value !== null;
  const context: unknown = new Proxy(state, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 20 });
      return (...args: unknown[]) => {
        if (key === "fillText") drawn.push(String(args[0]));
      };
    },
    set(target, key, value) {
      if (typeof key === "string") target[key] = value;
      return true;
    },
  });
  if (!isContext(context)) throw new Error("no context");
  return context;
}

describe("FieldCompletion — a host's own look", () => {
  const paintPage = (options: { paint?: (ctx: CanvasRenderingContext2D, field: SigningFieldDrawing) => boolean; roleColors?: Record<string, string> }) => {
    const { roleColors, ...completion } = options;
    editor = new LaidOutViewer({
      extensions: [
        StarterKit,
        Field.configure(roleColors ? { roleColors } : {}),
        FieldCompletion.configure({ fields: [signHere, witness], completable: [signHere.id], ...completion }),
      ],
      content,
      sealed: true,
    });
    editor.mountView();
    const map = new CharacterMap();
    map.registerObjectRect({ docPos: 8, x: 100, y: 600, width: 180, height: 44, page: 2, baseline: 644 });
    const drawn: string[] = [];
    editor.painters.at(-1)!(recordingContext(drawn), 2, defaultPageConfig, map, editor.getResolvedTheme());
    return drawn;
  };

  it("lets the host draw a field itself, told whose it is and whether this viewer completes it — in the colours given to Field", () => {
    const paint = vi.fn(() => true);
    const drawn = paintPage({ paint, roleColors: { "client-authorized-signatory": "#ff0000" } });

    expect(paint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "client-authorized-signatory", color: "#ff0000", own: true, baselineY: 644 }),
    );
    expect(drawn).toEqual([]);
  });

  it("draws Scrivr's own look when the host declines, in the party's colour", () => {
    const drawn = paintPage({ paint: () => false });

    expect(drawn.length).toBeGreaterThan(0);
    expect(fieldRoleColor("client-authorized-signatory", { "client-authorized-signatory": "#ff0000" })).toBe("#ff0000");
  });
});

describe("FieldCompletion — a host's own kinds", () => {
  it("draws and completes a host's kind as the control it declares — the kinds given to Field", () => {
    const agree: SignerFieldDescriptor = { id: "f-agree", role: "client", kind: "agree", required: true, options: [] };
    const kinds = { agree: { label: "I agree", size: { width: 16, height: 16 }, control: "checkbox" as const } };
    editor = new LaidOutViewer({
      extensions: [
        StarterKit,
        Field.configure({ kinds }),
        FieldCompletion.configure({ fields: [agree], completable: [agree.id], paint: (_ctx, field) => {
          seen.push(field.control);
          return true;
        } }),
      ],
      content: { type: "doc", content: [{ type: "paragraph", content: [fieldNode(agree)] }] },
      sealed: true,
    });
    const seen: string[] = [];
    editor.mountView();
    const map = new CharacterMap();
    map.registerObjectRect({ docPos: 1, x: 100, y: 600, width: 16, height: 16, page: 2 });
    editor.painters.at(-1)!(recordingContext([]), 2, defaultPageConfig, map, editor.getResolvedTheme());

    expect(seen).toEqual(["checkbox"]);
  });
});
