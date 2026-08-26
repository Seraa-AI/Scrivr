import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { InputBridge } from "./InputBridge";
import { PasteTransformer } from "./PasteTransformer";
import { CharacterMap } from "../layout/CharacterMap";
import type { EditorNavigator } from "../extensions/types";

/**
 * Clipboard behaviour is driven through the real DOM events the browser fires —
 * a keydown that records modifier state, then the paste event itself — because
 * the modifier and the clipboard arrive on two separate events and only their
 * pairing produces "paste without formatting".
 */

interface Harness {
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
  bridge: InputBridge;
  doc: () => string;
  docJSON: () => ReturnType<EditorState["doc"]["toJSON"]>;
}

function imagesInDocument(
  doc: ReturnType<EditorState["doc"]["toJSON"]>,
): { type: string }[] {
  return doc.content.flatMap((block: { content?: { type: string }[] }) =>
    (block.content ?? []).filter((node) => node.type === "image"),
  );
}

let harness: Harness | null = null;

function mountEditor(initialText = "Hello world"): Harness {
  const manager = new ExtensionManager([StarterKit]);
  const schema = manager.schema;
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, initialText ? [schema.text(initialText)] : []),
  ]);
  let state = EditorState.create({ schema, doc, plugins: manager.buildPlugins() });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));

  const container = document.createElement("div");
  document.body.appendChild(container);

  const bridge = new InputBridge({
    getState: () => state,
    dispatch: (tr: Transaction | null) => {
      if (tr) state = state.apply(tr);
    },
    getSchema: () => schema,
    getViewportRect: () => null,
    getCharMap: () => new CharacterMap(),
    keymap: manager.buildKeymap(),
    inputHandlers: manager.buildInputHandlers(),
    navigator: {} as EditorNavigator,
    pasteTransformer: new PasteTransformer(
      schema,
      manager.buildMarkdownRules(),
      manager.buildMarkdownParserTokens(),
    ),
    onFocus: () => {},
    onBlur: () => {},
  });
  bridge.mount(container);

  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("InputBridge did not create a textarea");

  return {
    container,
    textarea,
    bridge,
    doc: () => state.doc.textContent,
    docJSON: () => state.doc.toJSON(),
  };
}

/** A paste event carrying the formats a real clipboard would hold. */
function pasteEvent(data: Record<string, string>, files: File[] = []): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (key: string) => data[key] ?? "", files },
  });
  return event;
}

function keydown(
  textarea: HTMLTextAreaElement,
  key: string,
  modifiers: { metaKey?: boolean; shiftKey?: boolean } = {},
): void {
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }),
  );
}

beforeEach(() => {
  harness = mountEditor();
});

afterEach(() => {
  harness?.bridge.unmount();
  harness?.container.remove();
  harness = null;
});

describe("paste without formatting (Mod-Shift-v)", () => {
  it("keeps HTML formatting on an ordinary paste", () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true });
    h.textarea.dispatchEvent(
      pasteEvent({ "text/html": "<strong>bold</strong>", "text/plain": "bold" }),
    );

    expect(h.doc()).toBe("boldHello world");
    const first = h.docJSON().content[0].content[0];
    expect(first.marks?.map((m: { type: string }) => m.type)).toContain("bold");
  });

  it("drops HTML formatting when Shift is held on paste", () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true, shiftKey: true });
    h.textarea.dispatchEvent(
      pasteEvent({ "text/html": "<strong>bold</strong>", "text/plain": "bold" }),
    );

    expect(h.doc()).toBe("boldHello world");
    const first = h.docJSON().content[0].content[0];
    expect(first.marks ?? []).toEqual([]);
  });

  it("consumes paste-without-formatting so the next paste is formatted normally", () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true, shiftKey: true });
    h.textarea.dispatchEvent(
      pasteEvent({ "text/html": "<strong>plain</strong>", "text/plain": "plain" }),
    );

    // A context-menu paste has no preceding keydown. It must not inherit Shift
    // from the earlier keyboard paste.
    h.textarea.dispatchEvent(
      pasteEvent({ "text/html": "<strong>bold</strong>", "text/plain": "bold" }),
    );

    const content = h.docJSON().content[0].content;
    expect(content[0].marks ?? []).toEqual([]);
    expect(content[1].marks?.map((m: { type: string }) => m.type)).toContain("bold");
  });

  it("does not treat an unrelated Shift keydown as paste without formatting", () => {
    const h = harness!;
    keydown(h.textarea, "Shift", { shiftKey: true });
    h.textarea.dispatchEvent(
      pasteEvent({ "text/html": "<strong>bold</strong>", "text/plain": "bold" }),
    );

    const first = h.docJSON().content[0].content[0];
    expect(first.marks?.map((m: { type: string }) => m.type)).toContain("bold");
  });

  it("drops block structure when Shift is held, inserting text only", () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true, shiftKey: true });
    h.textarea.dispatchEvent(
      pasteEvent({
        "text/html": "<h1>Title</h1><p>Body</p>",
        "text/plain": "Title\nBody",
      }),
    );

    const json = h.docJSON();
    expect(json.content.every((n: { type: string }) => n.type === "paragraph")).toBe(true);
  });

  it("does not convert markdown when Shift is held", () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true, shiftKey: true });
    h.textarea.dispatchEvent(pasteEvent({ "text/plain": "# Heading" }));

    expect(h.docJSON().content[0].type).toBe("paragraph");
    expect(h.doc()).toBe("# HeadingHello world");
  });

  it("converts markdown on an ordinary paste", () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true });
    h.textarea.dispatchEvent(pasteEvent({ "text/plain": "# Heading" }));

    expect(h.docJSON().content.some((n: { type: string }) => n.type === "heading")).toBe(true);
  });

  it("returns to formatted paste once Shift is released", () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true, shiftKey: true });
    h.textarea.dispatchEvent(pasteEvent({ "text/html": "<strong>a</strong>", "text/plain": "a" }));
    keydown(h.textarea, "v", { metaKey: true });
    h.textarea.dispatchEvent(pasteEvent({ "text/html": "<strong>b</strong>", "text/plain": "b" }));

    // "a" pasted unformatted, then "b" pasted formatted after it: only the
    // second run carries the mark.
    const runs = h.docJSON().content[0].content;
    expect(runs[0].text).toBe("a");
    expect(runs[0].marks ?? []).toEqual([]);
    expect(runs[1].text).toBe("b");
    expect(runs[1].marks.map((m: { type: string }) => m.type)).toContain("bold");
  });
});

describe("pasting an image from the clipboard", () => {
  const png = (): File =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
      type: "image/png",
    });

  /** Image insertion resolves asynchronously; let its promise chain settle. */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));

  it("inserts an image when the clipboard holds only bytes", async () => {
    const h = harness!;
    h.textarea.dispatchEvent(pasteEvent({}, [png()]));
    await settle();

    const runs = h.docJSON().content[0].content;
    const image = runs.find((n: { type: string }) => n.type === "image");
    expect(image).toBeDefined();
    expect(String(image.attrs.src)).toMatch(/^data:image\/png;base64,/);
  });

  it("does not double-insert when the clipboard also holds HTML", async () => {
    const h = harness!;
    h.textarea.dispatchEvent(
      pasteEvent({ "text/html": `<img src="https://example.com/a.png">` }, [png()]),
    );
    await settle();

    const images = h
      .docJSON()
      .content.flatMap((b: { content?: { type: string }[] }) => b.content ?? [])
      .filter((n: { type: string }) => n.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].attrs.src).toBe("https://example.com/a.png");
  });

  it("leaves the document untouched when the file is not an image", async () => {
    const h = harness!;
    const before = h.doc();
    h.textarea.dispatchEvent(
      pasteEvent({}, [new File(["x"], "notes.txt", { type: "text/plain" })]),
    );
    await settle();

    expect(h.doc()).toBe(before);
  });
});

describe("paste-without-formatting gesture lifetime", () => {
  it("forgets a pending gesture when the editor loses focus", () => {
    const h = harness!;
    // Press the chord, then click away before pasting. A paste that arrives
    // after the editor was left is not part of that gesture.
    keydown(h.textarea, "v", { metaKey: true, shiftKey: true });
    h.textarea.dispatchEvent(new Event("blur", { bubbles: true }));
    h.textarea.dispatchEvent(
      pasteEvent({ "text/html": "<strong>bold</strong>", "text/plain": "bold" }),
    );

    const marks = h.docJSON().content[0].content[0].marks ?? [];
    expect(marks.map((m: { type: string }) => m.type)).toContain("bold");
  });
});

describe("image paste lands only while the editor can accept it", () => {
  const png = (): File =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
      type: "image/png",
    });

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));

  it("does not insert an image that resolves after the editor goes read-only", async () => {
    const h = harness!;
    const before = h.doc();
    h.textarea.dispatchEvent(pasteEvent({}, [png()]));
    // Read-only flips while the bytes are still being read.
    h.bridge.setReadOnly(true);
    await settle();

    expect(h.doc()).toBe(before);
    expect(imagesInDocument(h.docJSON())).toHaveLength(0);
  });

  it("does not insert an image that resolves after unmount", async () => {
    const h = harness!;
    const before = h.doc();
    h.textarea.dispatchEvent(pasteEvent({}, [png()]));
    h.bridge.unmount();
    await settle();

    expect(h.doc()).toBe(before);
    expect(imagesInDocument(h.docJSON())).toHaveLength(0);
  });

  it("survives a clipboard that throws while being read", async () => {
    const h = harness!;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: () => "",
        get files(): File[] {
          throw new Error("clipboard detached");
        },
      },
    });

    expect(() => h.textarea.dispatchEvent(event)).not.toThrow();
    await settle();
  });
});

describe("image paste interacts correctly with the other clipboard paths", () => {
  const png = (): File =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
      type: "image/png",
    });

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));

  const imagesIn = (h: Harness): { type: string }[] =>
    h
      .docJSON()
      .content.flatMap((b: { content?: { type: string }[] }) => b.content ?? [])
      .filter((n: { type: string }) => n.type === "image");

  it("inserts no image when pasting without formatting", async () => {
    const h = harness!;
    keydown(h.textarea, "v", { metaKey: true, shiftKey: true });
    h.textarea.dispatchEvent(pasteEvent({}, [png()]));
    await settle();

    expect(imagesIn(h)).toHaveLength(0);
  });

  it("inserts the image, not the file path, for a file copied from the desktop", async () => {
    // A file manager puts the bytes AND a text/plain path on the clipboard.
    const h = harness!;
    const before = h.doc();
    h.textarea.dispatchEvent(
      pasteEvent({ "text/plain": "file:///tmp/shot.png" }, [png()]),
    );
    await settle();

    expect(imagesIn(h)).toHaveLength(1);
    expect(h.doc()).toBe(before);
  });
});
