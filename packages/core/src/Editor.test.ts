import { describe, it, expect, vi } from "vitest";
import { Editor } from "./Editor";
import { StarterKit } from "./extensions/StarterKit";
import { Extension } from "./extensions/Extension";
import { NodeSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { createTestEditor } from "./test-utils";

/**
 * Editor tests — cursor movement, selection, and edge case safety.
 *
 * We mount the editor into a real (happy-dom) div so the textarea is
 * available, then simulate input via the textarea to seed document content.
 *
 * All assertions go through editor.getState().selection so we stay
 * framework-agnostic and don't depend on the canvas or layout engine.
 *
 * Canvas measurement comes from the real `@napi-rs/canvas` (Skia) backend
 * wired in `vitest.setup.ts` — no fake measureText.
 */

function makeEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  let latestState: EditorState | null = null;
  const editor = createTestEditor({
    onChange: (s) => { latestState = s; },
  });
  editor.mount(container);

  /** Type text into the editor via textarea simulation */
  function type(text: string) {
    const ta = container.querySelector("textarea")!;
    ta.value = text;
    ta.dispatchEvent(new Event("input"));
  }

  function cleanup() {
    editor.destroy();
    container.remove();
  }

  return {
    editor,
    container,
    type,
    cleanup,
    getState: () => latestState ?? editor.getState(),
  };
}

function findNodePos(state: EditorState, typeName: string): number | null {
  let found: number | null = null;
  state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === typeName) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function findTextPos(state: EditorState, text: string): number | null {
  let found: number | null = null;
  state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText && node.text?.includes(text)) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

// ── Initial cursor placement ──────────────────────────────────────────────────

describe("Editor — initial cursor placement", () => {
  it("places the cursor at the start of the document on mount", () => {
    const { editor, cleanup } = makeEditor();
    const sel = editor.getState().selection;
    // PM default: position 1 (inside the first paragraph, before any text)
    expect(sel.head).toBe(1);
    expect(sel.anchor).toBe(1);
    cleanup();
  });

  it("cursor is collapsed (not a selection) on mount", () => {
    const { editor, cleanup } = makeEditor();
    expect(editor.getState().selection.empty).toBe(true);
    cleanup();
  });
});

describe("Editor.ensureFullLayout", () => {
  it("synchronously completes a streamed initial layout", () => {
    const content = {
      type: "doc",
      content: Array.from({ length: 160 }, (_, index) => ({
        type: "paragraph",
        content: [{ type: "text", text: `Paragraph ${index + 1}` }],
      })),
    };
    const editor = createTestEditor({ content });

    const initialLayout = editor.layout;
    expect(initialLayout.isPartial).toBe(true);
    expect(
      initialLayout.pages.reduce((count, page) => count + page.blocks.length, 0),
    ).toBe(100);

    editor.ensureFullLayout();
    const fullLayout = editor.layout;

    expect(fullLayout.isPartial).toBeUndefined();
    expect(
      fullLayout.pages.reduce((count, page) => count + page.blocks.length, 0),
    ).toBe(160);

    editor.destroy();
  });

  it("lays out the full tail past a mid-document table (no truncated copy)", () => {
    // A tableRow bypasses the measure cache, so it's a cache miss mid-document;
    // the cached paragraphs after it used to trigger pagination's
    // early-termination, which copied the partial layout's truncated tail.
    const cell = (t: string) => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    });
    const para = (i: number) => ({
      type: "paragraph",
      content: [{ type: "text", text: `Paragraph ${i} with enough words to wrap across a couple of lines in the column.` }],
    });
    const content = {
      type: "doc",
      content: [
        ...Array.from({ length: 40 }, (_, i) => para(i + 1)),
        {
          type: "table",
          attrs: { layout: "fixed", grid: [100, 100] },
          content: [{ type: "tableRow", content: [cell("A"), cell("B")] }],
        },
        ...Array.from({ length: 260 }, (_, i) => para(i + 41)),
      ],
    };
    const editor = createTestEditor({
      content,
      extensions: [StarterKit.configure({ table: true })],
    });
    expect(editor.layout.isPartial).toBe(true); // 300 paragraphs → streamed

    editor.ensureFullLayout();

    // Every paragraph must survive (≥300 blocks; page splits add a few more).
    const blocks = editor.layout.pages.reduce((c, p) => c + p.blocks.length, 0);
    expect(editor.layout.isPartial).toBeUndefined();
    expect(blocks).toBeGreaterThanOrEqual(300);

    editor.destroy();
  });
});

describe("Editor.moveNode", () => {
  function installImageParagraph(editor: Editor) {
    const schema = editor.schema;
    const image = schema.nodes["image"]!.create({
      src: "",
      width: 100,
      height: 80,
      wrappingMode: "square-left",
      floatOffset: { x: 0, y: 0 },
    });
    const para = schema.node("paragraph", null, [
      schema.text("A"),
      image,
      schema.text("B"),
    ]);
    editor.applyTransaction(
      editor.getState().tr.replaceWith(0, editor.getState().doc.content.size, para),
    );
    return { imagePos: 2, paragraphEnd: editor.getState().doc.resolve(2).end(1), paragraphStart: editor.getState().doc.resolve(2).start(1) };
  }

  it("moves an inline image structurally to the start of its paragraph", () => {
    const { editor, cleanup } = makeEditor();
    const { imagePos, paragraphStart } = installImageParagraph(editor);

    expect(editor.moveNode(imagePos, paragraphStart)).toBe(true);

    const movedPara = editor.getState().doc.firstChild!;
    expect(movedPara.child(0).type.name).toBe("image");
    expect(movedPara.textContent).toBe("AB");
    expect(editor.getState().selection.from).toBe(1);
    cleanup();
  });

  it("moves an inline image structurally to the end of its paragraph", () => {
    const { editor, cleanup } = makeEditor();
    const { imagePos, paragraphEnd } = installImageParagraph(editor);

    expect(editor.moveNode(imagePos, paragraphEnd)).toBe(true);

    const movedPara = editor.getState().doc.firstChild!;
    expect(movedPara.child(movedPara.childCount - 1).type.name).toBe("image");
    expect(movedPara.textContent).toBe("AB");
    cleanup();
  });
});

describe("Editor.convertImageToInlineAtVisualPosition", () => {
  it("moves a floating image to the visual insertion point and clears placement attrs", () => {
    const { editor, cleanup } = makeEditor();
    const schema = editor.schema;
    const image = schema.nodes["image"]!.create({
      src: "",
      width: 100,
      height: 80,
      wrapMode: "square",
      xAlign: "custom",
      x: 120,
      yOffset: -20,
      floatOffset: { x: 0, y: 40 },
    });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Before")]),
      schema.node("paragraph", null, [image]),
    ]);
    editor.applyTransaction(
      editor.getState().tr.replaceWith(0, editor.getState().doc.content.size, doc.content),
    );

    let imagePos = -1;
    editor.getState().doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePos = pos;
    });
    expect(imagePos).toBeGreaterThan(0);

    const posAtCoords = vi.spyOn(editor.charMap, "posAtCoords").mockReturnValue(1);
    expect(editor.convertImageToInlineAtVisualPosition(imagePos)).toBe(true);

    const firstParagraph = editor.getState().doc.child(0);
    const movedImage = firstParagraph.child(0);
    expect(editor.getState().doc.childCount).toBe(1);
    expect(movedImage.type.name).toBe("image");
    expect(movedImage.attrs["wrapMode"]).toBe("inline");
    expect(movedImage.attrs["wrappingMode"]).toBe("inline");
    expect(movedImage.attrs["x"]).toBeNull();
    expect(movedImage.attrs["yOffset"]).toBe(0);
    expect(movedImage.attrs["floatOffset"]).toEqual({ x: 0, y: 0 });
    expect(posAtCoords).toHaveBeenCalled();
    cleanup();
  });

  it("removes the old image-only anchor paragraph when moving the image", () => {
    const { editor, cleanup } = makeEditor();
    const schema = editor.schema;
    const image = schema.nodes["image"]!.create({
      src: "",
      width: 100,
      height: 80,
      wrapMode: "square",
    });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Before")]),
      schema.node("paragraph", null, [image]),
      schema.node("paragraph", null, [schema.text("After")]),
    ]);
    editor.applyTransaction(
      editor.getState().tr.replaceWith(0, editor.getState().doc.content.size, doc.content),
    );

    const imagePos = findNodePos(editor.getState(), "image")!;
    const afterPos = findTextPos(editor.getState(), "After")!;

    expect(editor.moveAndUpdateNode(imagePos, afterPos, { yOffset: 0 })).toBe(true);

    const paragraphs = Array.from({ length: editor.getState().doc.childCount }, (_, index) =>
      editor.getState().doc.child(index),
    );
    expect(paragraphs.map((node) => node.textContent)).toEqual(["Before", "After"]);
    expect(paragraphs.every((node) => node.childCount > 0)).toBe(true);
    cleanup();
  });
});

// ── moveCursorTo ─────────────────────────────────────────────────────────────

describe("Editor.moveCursorTo", () => {
  it("does not throw when called with position 0", () => {
    const { editor, cleanup } = makeEditor();
    expect(() => editor.selection.moveCursorTo(0)).not.toThrow();
    cleanup();
  });

  it("clamps to a valid position when called with a negative number", () => {
    const { editor, cleanup } = makeEditor();
    expect(() => editor.selection.moveCursorTo(-999)).not.toThrow();
    cleanup();
  });

  it("clamps to a valid position when called beyond doc end", () => {
    const { editor, cleanup } = makeEditor();
    expect(() => editor.selection.moveCursorTo(999999)).not.toThrow();
    cleanup();
  });

  it("places the cursor at a valid position inside the document", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    // "Hello" in one paragraph: positions 1-5 are the characters
    editor.selection.moveCursorTo(3);
    const sel = editor.getState().selection;
    expect(sel.empty).toBe(true);
    expect(sel.head).toBeGreaterThanOrEqual(1);
    cleanup();
  });
});

// ── setSelection ─────────────────────────────────────────────────────────────

describe("Editor.setSelection", () => {
  it("creates a non-collapsed selection", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 4);
    const sel = editor.getState().selection;
    expect(sel.empty).toBe(false);
    expect(sel.from).toBe(1);
    expect(sel.to).toBe(4);
    cleanup();
  });

  it("anchor and head can be reversed (backward selection)", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(4, 1);
    const sel = editor.getState().selection;
    expect(sel.from).toBe(1);
    expect(sel.to).toBe(4);
    expect(sel.anchor).toBe(4);
    expect(sel.head).toBe(1);
    cleanup();
  });

  it("equal anchor and head collapses to a cursor", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(3, 3);
    const sel = editor.getState().selection;
    expect(sel.empty).toBe(true);
    cleanup();
  });

  it("does not throw with out-of-range positions", () => {
    const { editor, cleanup } = makeEditor();
    expect(() => editor.selection.setSelection(0, 999)).not.toThrow();
    cleanup();
  });
});

// ── moveLeft / moveRight ──────────────────────────────────────────────────────

describe("Editor.moveLeft / moveRight", () => {
  it("moveRight advances the cursor by one position", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.moveCursorTo(1);
    const before = editor.getState().selection.head;
    editor.selection.moveRight();
    const after = editor.getState().selection.head;
    expect(after).toBeGreaterThan(before);
    cleanup();
  });

  it("moveLeft moves the cursor back by one position", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.moveCursorTo(3);
    const before = editor.getState().selection.head;
    editor.selection.moveLeft();
    const after = editor.getState().selection.head;
    expect(after).toBeLessThan(before);
    cleanup();
  });

  it("moveLeft at the document start is a no-op", () => {
    const { editor, cleanup } = makeEditor();
    // Move to start
    editor.selection.moveCursorTo(1);
    const before = editor.getState().selection.head;
    editor.selection.moveLeft();
    const after = editor.getState().selection.head;
    expect(after).toBe(before);
    cleanup();
  });

  it("moveRight at the document end is a no-op", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hi");
    const docSize = editor.getState().doc.content.size;
    editor.selection.moveCursorTo(docSize);
    const before = editor.getState().selection.head;
    editor.selection.moveRight();
    const after = editor.getState().selection.head;
    expect(after).toBe(before);
    cleanup();
  });

  it("moveRight(true) extends the selection rightward", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.moveCursorTo(2);
    const anchor = editor.getState().selection.anchor;
    editor.selection.moveRight(true);
    const sel = editor.getState().selection;
    expect(sel.empty).toBe(false);
    expect(sel.anchor).toBe(anchor); // anchor does not move
    expect(sel.head).toBeGreaterThan(anchor);
    cleanup();
  });

  it("moveLeft(true) extends the selection leftward", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.moveCursorTo(4);
    const anchor = editor.getState().selection.anchor;
    editor.selection.moveLeft(true);
    const sel = editor.getState().selection;
    expect(sel.empty).toBe(false);
    expect(sel.anchor).toBe(anchor); // anchor does not move
    expect(sel.head).toBeLessThan(anchor);
    cleanup();
  });

  it("moveRight selects a non-inline image instead of landing in its hidden anchor paragraph", () => {
    const { editor, cleanup } = makeEditor();
    const schema = editor.schema;
    const image = schema.nodes["image"]!.create({
      src: "",
      width: 120,
      height: 80,
      wrapMode: "square",
    });
    const title = "Layout Engine";
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, [schema.text(title)]),
      schema.node("paragraph", null, [image]),
      schema.node("paragraph", null, [schema.text("Body text")]),
    ]);
    editor.applyTransaction(
      editor.getState().tr.replaceWith(0, editor.getState().doc.content.size, doc.content),
    );

    const imagePos = findNodePos(editor.getState(), "image")!;
    editor.selection.moveCursorTo(1 + title.length);
    editor.selection.moveRight();

    const sel = editor.getState().selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect(sel.from).toBe(imagePos);
    cleanup();
  });

  it("shift+moveRight skips a hidden anchor paragraph when extending selection", () => {
    const { editor, cleanup } = makeEditor();
    const schema = editor.schema;
    const image = schema.nodes["image"]!.create({
      src: "",
      width: 120,
      height: 80,
      wrapMode: "square",
    });
    const title = "Layout Engine";
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, [schema.text(title)]),
      schema.node("paragraph", null, [image]),
      schema.node("paragraph", null, [schema.text("Body text")]),
    ]);
    editor.applyTransaction(
      editor.getState().tr.replaceWith(0, editor.getState().doc.content.size, doc.content),
    );

    const imagePos = findNodePos(editor.getState(), "image")!;
    editor.selection.moveCursorTo(1 + title.length);
    editor.selection.moveRight(true);

    const sel = editor.getState().selection;
    expect(sel).not.toBeInstanceOf(NodeSelection);
    expect(sel.head).toBeGreaterThan(imagePos + image.nodeSize);
    cleanup();
  });

  it("typing replaces the active selection", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 4); // select "Hel"
    type("X");                  // type replaces selection
    expect(editor.getState().doc.textContent).toBe("Xlo");
    cleanup();
  });
});

// ── paste ────────────────────────────────────────────────────────────────────

describe("Editor — paste", () => {
  function paste(container: HTMLElement, text: string) {
    const ta = container.querySelector("textarea")!;
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    event.clipboardData!.setData("text/plain", text);
    ta.dispatchEvent(event);
  }

  it("inserts pasted plain text at the cursor", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "Hello");
    expect(editor.getState().doc.textContent).toBe("Hello");
    cleanup();
  });

  it("replaces the active selection with pasted text", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 4); // select "Hel"
    paste(container, "X");
    expect(editor.getState().doc.textContent).toBe("Xlo");
    cleanup();
  });

  it("does nothing when paste data is empty", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    const before = editor.getState().doc.textContent;
    paste(container, "");
    expect(editor.getState().doc.textContent).toBe(before);
    cleanup();
  });
});

// ── HTML paste ───────────────────────────────────────────────────────────────

describe("Editor — HTML paste", () => {
  function pasteHtml(container: HTMLElement, html: string, plain = "") {
    const ta = container.querySelector("textarea")!;
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    event.clipboardData!.setData("text/html", html);
    if (plain) event.clipboardData!.setData("text/plain", plain);
    ta.dispatchEvent(event);
  }

  it("pastes bold text from HTML", () => {
    const { editor, container, cleanup } = makeEditor();
    pasteHtml(container, "<b>Hello</b>");
    expect(editor.getState().doc.textContent).toBe("Hello");
    let hasBold = false;
    editor.getState().doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "bold")) hasBold = true;
    });
    expect(hasBold).toBe(true);
    cleanup();
  });

  it("pastes a heading from HTML", () => {
    const { editor, container, cleanup } = makeEditor();
    pasteHtml(container, "<h2>My Heading</h2>");
    expect(editor.getState().doc.textContent).toBe("My Heading");
    let foundHeading = false;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "heading" && node.attrs["level"] === 2) foundHeading = true;
    });
    expect(foundHeading).toBe(true);
    cleanup();
  });

  it("pastes a bullet list from HTML", () => {
    const { editor, container, cleanup } = makeEditor();
    pasteHtml(container, "<ul><li>Alpha</li><li>Beta</li></ul>");
    expect(editor.getState().doc.textContent).toBe("AlphaBeta");
    let foundList = false;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "bulletList") foundList = true;
    });
    expect(foundList).toBe(true);
    cleanup();
  });

  it("strips unsupported tags and preserves text", () => {
    const { editor, container, cleanup } = makeEditor();
    pasteHtml(container, "<meta charset='utf-8'><p>Clean text</p>");
    expect(editor.getState().doc.textContent).toBe("Clean text");
    cleanup();
  });

  it("HTML takes priority over plain text", () => {
    const { editor, container, cleanup } = makeEditor();
    pasteHtml(container, "<b>Rich</b>", "plain fallback");
    // Should use HTML path — bold mark present
    let hasBold = false;
    editor.getState().doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "bold")) hasBold = true;
    });
    expect(hasBold).toBe(true);
    cleanup();
  });
});

// ── Markdown paste ────────────────────────────────────────────────────────────

describe("Editor — Markdown paste", () => {
  function paste(container: HTMLElement, text: string) {
    const ta = container.querySelector("textarea")!;
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    event.clipboardData!.setData("text/plain", text);
    ta.dispatchEvent(event);
  }

  it("pastes a markdown heading as a heading node", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "# Hello World");
    expect(editor.getState().doc.textContent).toBe("Hello World");
    let foundHeading = false;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "heading" && node.attrs["level"] === 1) foundHeading = true;
    });
    expect(foundHeading).toBe(true);
    cleanup();
  });

  it("pastes markdown h2 correctly", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "## Subtitle");
    let level = 0;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "heading") level = node.attrs["level"] as number;
    });
    expect(level).toBe(2);
    cleanup();
  });

  it("pastes **bold** as bold mark", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "- **bold item**");
    let hasBold = false;
    editor.getState().doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "bold")) hasBold = true;
    });
    expect(hasBold).toBe(true);
    cleanup();
  });

  it("pastes a bullet list as bulletList node", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "- Alpha\n- Beta\n- Gamma");
    expect(editor.getState().doc.textContent).toBe("AlphaBetaGamma");
    let listItemCount = 0;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "listItem") listItemCount++;
    });
    expect(listItemCount).toBe(3);
    cleanup();
  });

  it("pastes an ordered list as orderedList node", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "1. First\n2. Second");
    let foundOrderedList = false;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "orderedList") foundOrderedList = true;
    });
    expect(foundOrderedList).toBe(true);
    cleanup();
  });

  it("does NOT parse plain text without markdown patterns as markdown", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "This is a normal sentence with no markdown.");
    expect(editor.getState().doc.textContent).toBe("This is a normal sentence with no markdown.");
    // No heading or list nodes — just a paragraph
    let hasSpecialNode = false;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "heading" || node.type.name === "bulletList") hasSpecialNode = true;
    });
    expect(hasSpecialNode).toBe(false);
    cleanup();
  });

  it("mid-sentence asterisks are NOT treated as markdown", () => {
    const { editor, container, cleanup } = makeEditor();
    paste(container, "Section 4* applies here. See also clause 2*.");
    // No bold marks created
    let hasBold = false;
    editor.getState().doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "bold")) hasBold = true;
    });
    expect(hasBold).toBe(false);
    cleanup();
  });
});

// ── getActiveMarks ───────────────────────────────────────────────────────────

describe("Editor.getActiveMarks", () => {
  it("returns empty array when cursor is in plain text", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.moveCursorTo(3);
    expect(editor.getActiveMarks()).toEqual([]);
    cleanup();
  });

  it("returns ['bold'] after toggling bold with cursor collapsed", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["toggleBold"]?.();
    expect(editor.getActiveMarks()).toContain("bold");
    cleanup();
  });

  it("returns ['bold'] when entire selection is bold", () => {
    const { editor, type, cleanup } = makeEditor();
    // Apply bold to "Hello" by selecting it then toggling
    type("Hello");
    editor.selection.setSelection(1, 6);
    editor.commands["toggleBold"]?.();
    editor.selection.setSelection(1, 6);
    expect(editor.getActiveMarks()).toContain("bold");
    cleanup();
  });

  it("does not return 'bold' when selection is mixed (some plain, some bold)", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    // Bold only "Hel" (positions 1-4)
    editor.selection.setSelection(1, 4);
    editor.commands["toggleBold"]?.();
    // Now select the full word including non-bold part
    editor.selection.setSelection(1, 6);
    expect(editor.getActiveMarks()).not.toContain("bold");
    cleanup();
  });

  it("returns ['italic'] after toggling italic", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["toggleItalic"]?.();
    expect(editor.getActiveMarks()).toContain("italic");
    cleanup();
  });

  it("returns both marks when bold and italic are both active", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["toggleBold"]?.();
    editor.commands["toggleItalic"]?.();
    const marks = editor.getActiveMarks();
    expect(marks).toContain("bold");
    expect(marks).toContain("italic");
    cleanup();
  });
});

// ── CursorManager integration ────────────────────────────────────────────────

describe("Editor — CursorManager", () => {
  it("cursorManager.isVisible is true after construction", () => {
    const { editor, cleanup } = makeEditor();
    // CursorManager starts in visible state (timer not yet running, but visible=true)
    expect(editor.cursorManager.isVisible).toBe(true);
    cleanup();
  });

  it("cursorManager.reset() keeps isVisible true and restarts timer", () => {
    const { editor, cleanup } = makeEditor();
    editor.cursorManager.reset();
    expect(editor.cursorManager.isVisible).toBe(true);
    editor.cursorManager.stop();
    cleanup();
  });
});

// ── Heading commands ─────────────────────────────────────────────────────────

describe("Editor — heading commands", () => {
  it("setHeading1 converts the current paragraph to h1", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["setHeading1"]?.();
    const info = editor.getBlockInfo();
    expect(info.blockType).toBe("heading");
    expect(info.blockAttrs["level"]).toBe(1);
    cleanup();
  });

  it("setParagraph converts a heading back to paragraph", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["setHeading1"]?.();
    editor.commands["setParagraph"]?.();
    const info = editor.getBlockInfo();
    expect(info.blockType).toBe("paragraph");
    cleanup();
  });

  it("getBlockInfo returns paragraph for plain text", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    const info = editor.getBlockInfo();
    expect(info.blockType).toBe("paragraph");
    cleanup();
  });
});

// ── List commands ─────────────────────────────────────────────────────────────

describe("Editor — list commands", () => {
  it("toggleBulletList wraps a paragraph into a bullet list", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleBulletList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("bulletList");
    expect(editor.getState().doc.textContent).toBe("Hello");
    cleanup();
  });

  it("toggleBulletList a second time removes the list (toggle off)", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleBulletList"]?.();
    editor.commands["toggleBulletList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("paragraph");
    expect(editor.getState().doc.textContent).toBe("Hello");
    cleanup();
  });

  it("toggleOrderedList wraps a paragraph into an ordered list", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleOrderedList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("orderedList");
    cleanup();
  });

  it("toggleOrderedList a second time removes the list (toggle off)", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleOrderedList"]?.();
    editor.commands["toggleOrderedList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("paragraph");
    cleanup();
  });

  it("toggleOrderedList while in a bullet list converts to ordered list", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleBulletList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("bulletList");
    editor.commands["toggleOrderedList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("orderedList");
    expect(editor.getState().doc.textContent).toBe("Hello");
    cleanup();
  });

  it("toggleBulletList while in an ordered list converts to bullet list", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleOrderedList"]?.();
    editor.commands["toggleBulletList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("bulletList");
    cleanup();
  });

  it("getBlockInfo returns bulletList when cursor is inside a bullet list", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleBulletList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("bulletList");
    cleanup();
  });

  it("getBlockInfo returns paragraph after list is removed", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["toggleBulletList"]?.();
    editor.commands["toggleBulletList"]?.();
    expect(editor.getBlockInfo().blockType).toBe("paragraph");
    cleanup();
  });
});

// ── Alignment commands ────────────────────────────────────────────────────────

describe("Editor — alignment commands", () => {
  it("setAlignCenter changes paragraph align attr to center", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["setAlignCenter"]?.();
    expect(editor.getBlockInfo().blockAttrs["align"]).toBe("center");
    cleanup();
  });

  it("setAlignRight changes paragraph align attr to right", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["setAlignRight"]?.();
    expect(editor.getBlockInfo().blockAttrs["align"]).toBe("right");
    cleanup();
  });

  it("setAlignLeft restores default alignment", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["setAlignCenter"]?.();
    editor.commands["setAlignLeft"]?.();
    expect(editor.getBlockInfo().blockAttrs["align"]).toBe("left");
    cleanup();
  });

  it("setAlignCenter preserves heading level attr", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["setHeading2"]?.();
    editor.commands["setAlignCenter"]?.();
    const info = editor.getBlockInfo();
    expect(info.blockType).toBe("heading");
    expect(info.blockAttrs["level"]).toBe(2);
    expect(info.blockAttrs["align"]).toBe("center");
    cleanup();
  });

  it("setAlignJustify sets align to justify", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.commands["setAlignJustify"]?.();
    expect(editor.getBlockInfo().blockAttrs["align"]).toBe("justify");
    cleanup();
  });
});

// ── Underline / Strikethrough ─────────────────────────────────────────────────

describe("Editor — underline and strikethrough", () => {
  it("toggleUnderline adds underline mark", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["toggleUnderline"]?.();
    expect(editor.getActiveMarks()).toContain("underline");
    cleanup();
  });

  it("toggleStrikethrough adds strikethrough mark", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["toggleStrikethrough"]?.();
    expect(editor.getActiveMarks()).toContain("strikethrough");
    cleanup();
  });

  it("typing after toggleUnderline produces text with underline mark", () => {
    const { editor, type, cleanup } = makeEditor();
    editor.commands["toggleUnderline"]?.();
    type("Hello");
    let foundUnderline = false;
    editor.getState().doc.descendants((node) => {
      if (node.isText) {
        if (node.marks.some((m) => m.type.name === "underline")) foundUnderline = true;
      }
    });
    expect(foundUnderline).toBe(true);
    cleanup();
  });

  it("typing after toggleStrikethrough produces text with strikethrough mark", () => {
    const { editor, type, cleanup } = makeEditor();
    editor.commands["toggleStrikethrough"]?.();
    type("Hello");
    let foundStrikethrough = false;
    editor.getState().doc.descendants((node) => {
      if (node.isText) {
        if (node.marks.some((m) => m.type.name === "strikethrough")) foundStrikethrough = true;
      }
    });
    expect(foundStrikethrough).toBe(true);
    cleanup();
  });

  it("toggling underline on a selection marks all text nodes", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 6);
    editor.commands["toggleUnderline"]?.();
    let allUnderlined = true;
    editor.getState().doc.descendants((node) => {
      if (node.isText && node.text) {
        if (!node.marks.some((m) => m.type.name === "underline")) allUnderlined = false;
      }
    });
    expect(allUnderlined).toBe(true);
    cleanup();
  });

  it("toggling strikethrough off removes the mark", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 6);
    editor.commands["toggleStrikethrough"]?.();
    // toggleStrikethrough again should remove it
    editor.selection.setSelection(1, 6);
    editor.commands["toggleStrikethrough"]?.();
    expect(editor.getActiveMarks()).not.toContain("strikethrough");
    cleanup();
  });
});

// ── keyboard event dispatch ───────────────────────────────────────────────────
// These tests guard against regressions where a keymap command runs but
// e.preventDefault() is not called, causing the browser's default textarea
// behaviour to also fire (e.g. Enter inserts "\n" as text, Tab shifts focus).

describe("Editor — keyboard event handling", () => {
  /** Fire a keydown on the textarea and return the event (so callers can
   *  check .defaultPrevented). */
  function pressKey(
    container: HTMLElement,
    key: string,
    opts: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}
  ): KeyboardEvent {
    const ta = container.querySelector("textarea")!;
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    ta.dispatchEvent(event);
    return event;
  }

  it("Enter inside a list calls splitListItem and prevents default", () => {
    const { editor, type, container, cleanup } = makeEditor();

    editor.commands["toggleBulletList"]?.();
    type("Hello");

    const docBefore = editor.getState().doc.toString();
    const event = pressKey(container, "Enter");

    // Default must be prevented — no "\n" leaks into handleInput
    expect(event.defaultPrevented).toBe(true);
    // List item was split — doc structure changed
    expect(editor.getState().doc.toString()).not.toBe(docBefore);
    // textContent must still be "Hello", not "Hello\n"
    expect(editor.getState().doc.textContent).toBe("Hello");
    cleanup();
  });

  it("Enter outside a list prevents default and does not insert newline text", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");

    const event = pressKey(container, "Enter");

    // splitBlock is registered — default must be prevented
    expect(event.defaultPrevented).toBe(true);
    // No literal "\n" must appear in the document text
    expect(editor.getState().doc.textContent).not.toContain("\n");
    cleanup();
  });

  it("Tab is always prevented regardless of context (never shifts browser focus)", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");

    const event = pressKey(container, "Tab");
    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it("Tab outside a list is prevented and inserts no text", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");

    pressKey(container, "Tab");
    // No tab character must appear in the document
    expect(editor.getState().doc.textContent).toBe("Hello");
    cleanup();
  });

  it("Tab inside a list is prevented and inserts no text", () => {
    const { editor, type, container, cleanup } = makeEditor();

    editor.commands["toggleBulletList"]?.();
    type("Item 1");
    pressKey(container, "Enter");
    type("Item 2");

    const event = pressKey(container, "Tab");
    expect(event.defaultPrevented).toBe(true);
    // No tab character must appear in the document
    expect(editor.getState().doc.textContent).not.toContain("\t");
    cleanup();
  });

  it("Shift-Tab is always prevented", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");

    const event = pressKey(container, "Tab", { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it("Space key resolves to 'Space' in keymap lookup (not ' ')", () => {
    // Register a command under the ProseMirror-convention key "Space" via a
    // tiny extension and verify that pressing the space bar dispatches it.
    let called = false;
    const spaceExt = Extension.create({
      name: "test_space_binding",
      addKeymap: () => ({
        Space: () => {
          called = true;
          return true;
        },
      }),
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({ extensions: [StarterKit, spaceExt] });
    editor.mount(container);

    pressKey(container, " ");
    expect(called).toBe(true);

    editor.destroy();
    container.remove();
  });
});

// ── Phase 2: lazy CharacterMap + cursorPage ───────────────────────────────────

describe("Editor — cursorPage", () => {
  it("returns 1 for a fresh single-page document", () => {
    const { editor, cleanup } = makeEditor();
    expect(editor.cursorPage).toBe(1);
    cleanup();
  });

  it("reflects the page the cursor is on after typing", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    // Still a single page — cursor page should remain 1
    expect(editor.cursorPage).toBe(1);
    cleanup();
  });

  it("only populates the cursor page and its neighbours in the charmap", () => {
    const { editor, cleanup } = makeEditor();

    // Access the private populatedPages set via the public ensurePagePopulated
    // contract: after ensureLayout, only pages cursor±1 should be in the set.
    // We verify indirectly: calling ensurePagePopulated for page 99 (doesn't exist)
    // is a no-op and won't throw.
    expect(() => editor.ensurePagePopulated(99)).not.toThrow();

    // The charmap should have entries for page 1 (the only page) after construction.
    const coords = editor.charMap.coordsAtPos(1);
    // A fresh doc has an empty paragraph — coordsAtPos may return null (no glyphs)
    // or a result on page 1. Either way it must NOT be on a page other than 1.
    if (coords !== null) {
      expect(coords.page).toBe(1);
    }
    cleanup();
  });

  it("charmap.coordsAtPos with scopeToPage only returns glyphs from that page", () => {
    const { editor, type, cleanup } = makeEditor();
    type("Hello");
    // The cursor is after "Hello" — coordsAtPos with scopeToPage=1 should
    // return a result on page 1 (the only page).
    const sel = editor.getSelectionSnapshot();
    const coords = editor.charMap.coordsAtPos(sel.head, 1);
    expect(coords).not.toBeNull();
    expect(coords?.page).toBe(1);

    // Scoped to a page that doesn't exist — should return null.
    const wrongPage = editor.charMap.coordsAtPos(sel.head, 99);
    expect(wrongPage).toBeNull();
    cleanup();
  });

  it("cursorPage returns page 2 when cursor is in the continuation block of a split paragraph", () => {
    // Regression: _blockIndex used nodePos ranges which overlap for split-paragraph
    // blocks (kept part on page 1 and continuation on page 2 share the same nodePos
    // and nodeSize). Binary search always returned page 1, so cursorPage was stuck
    // at 1 even when the cursor was visually on page 2.
    //
    // Setup: tiny pages so any reasonable amount of text overflows. Word count
    // is generous (real Skia widths vary by font/glyph, so don't hand-compute
    // line counts — just produce enough text to guarantee a split).
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({
      extensions: [StarterKit.configure({ pagination: { pageWidth: 200, pageHeight: 200, margins: { top: 20, bottom: 20, left: 20, right: 20 } } })],
    });
    editor.mount(container);

    const ta = container.querySelector("textarea")!;
    ta.value = "hello ".repeat(60).trim();
    ta.dispatchEvent(new Event("input"));
    editor.ensureLayout();
    expect(editor.layout.pages.length).toBeGreaterThanOrEqual(2);
    editor.ensurePagePopulated(2);

    // End-of-paragraph cursor must resolve to the last page (>= 2).
    const para = editor.getState().doc.child(0)!;
    const endCursorPos = 1 + para.content.size;
    editor.selection.moveCursorTo(endCursorPos);
    editor.ensureLayout();
    expect(editor.cursorPage).toBe(editor.layout.pages.length);
    expect(editor.cursorPage).toBeGreaterThanOrEqual(2);

    editor.destroy();
    container.remove();
  });

  it("cursorPage resolves correctly for all three parts of a 3-page paragraph split", () => {
    // Geometry: pageWidth=200 pageHeight=200 margins=20. Generate enough text
    // for at least three pages, then derive cursor positions from the layout
    // (real Skia widths preclude hand-computed offsets).
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({
      extensions: [StarterKit.configure({ pagination: { pageWidth: 200, pageHeight: 200, margins: { top: 20, bottom: 20, left: 20, right: 20 } } })],
    });
    editor.mount(container);

    const ta = container.querySelector("textarea")!;
    ta.value = "hello ".repeat(120).trim();
    ta.dispatchEvent(new Event("input"));
    editor.ensureLayout();
    expect(editor.layout.pages.length).toBeGreaterThanOrEqual(3);
    editor.ensurePagePopulated(1);
    editor.ensurePagePopulated(2);
    editor.ensurePagePopulated(3);

    const para = editor.getState().doc.child(0)!;

    /** First doc position rendered on `page` — read from the first span of
     * page's first block's first line. */
    function firstDocPosOnPage(page: number): number {
      const block = editor.layout.pages[page - 1]!.blocks[0]!;
      const span = block.lines[0]!.spans[0]!;
      return span.docPos;
    }

    // Part 1: cursor at very start of paragraph → page 1.
    editor.selection.moveCursorTo(firstDocPosOnPage(1));
    editor.ensureLayout();
    expect(editor.cursorPage).toBe(1);

    // Part 2: cursor at first char of page 2 → page 2.
    editor.selection.moveCursorTo(firstDocPosOnPage(2));
    editor.ensureLayout();
    expect(editor.cursorPage).toBe(2);

    // Part 3: cursor at first char of page 3 → page 3.
    editor.selection.moveCursorTo(firstDocPosOnPage(3));
    editor.ensureLayout();
    expect(editor.cursorPage).toBe(3);

    // End of paragraph: stays on the last page.
    const lastPage = editor.layout.pages.length;
    editor.selection.moveCursorTo(1 + para.content.size);
    editor.ensureLayout();
    expect(editor.cursorPage).toBe(lastPage);

    editor.destroy();
    container.remove();
  });
});

// ── copy / cut ────────────────────────────────────────────────────────────────

describe("Editor — copy and cut", () => {
  /** Dispatch a copy/cut event on the textarea and return the clipboardData. */
  function dispatchClipboard(
    container: HTMLElement,
    type: "copy" | "cut",
  ): DataTransfer {
    const ta = container.querySelector("textarea")!;
    const dt = new DataTransfer();
    const event = new ClipboardEvent(type, {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    ta.dispatchEvent(event);
    return dt;
  }

  it("copy writes text/plain of the selected text", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 6);
    const dt = dispatchClipboard(container, "copy");
    expect(dt.getData("text/plain")).toBe("Hello");
    cleanup();
  });

  it("copy writes text/html containing the selected text", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 6);
    const dt = dispatchClipboard(container, "copy");
    const html = dt.getData("text/html");
    expect(html).toContain("Hello");
    cleanup();
  });

  it("copy with an empty selection writes nothing to clipboard", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    editor.selection.moveCursorTo(3); // collapsed cursor
    const dt = dispatchClipboard(container, "copy");
    expect(dt.getData("text/plain")).toBe("");
    cleanup();
  });

  it("cut writes text/plain of the selected text", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 6);
    const dt = dispatchClipboard(container, "cut");
    expect(dt.getData("text/plain")).toBe("Hello");
    cleanup();
  });

  it("cut removes the selected text from the document", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello World");
    // Select "Hello " (positions 1–7)
    editor.selection.setSelection(1, 7);
    dispatchClipboard(container, "cut");
    expect(editor.getState().doc.textContent).toBe("World");
    cleanup();
  });

  it("cut writes text/html of the selected content", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    editor.selection.setSelection(1, 6);
    const dt = dispatchClipboard(container, "cut");
    const html = dt.getData("text/html");
    expect(html).toContain("Hello");
    cleanup();
  });

  it("cut with an empty selection leaves the document unchanged", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Hello");
    editor.selection.moveCursorTo(3); // collapsed cursor
    dispatchClipboard(container, "cut");
    expect(editor.getState().doc.textContent).toBe("Hello");
    cleanup();
  });

  it("copy of bold text serializes <strong> in the HTML", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("Bold");
    editor.selection.setSelection(1, 5);
    editor.commands["toggleBold"]?.();
    editor.selection.setSelection(1, 5);
    const dt = dispatchClipboard(container, "copy");
    const html = dt.getData("text/html");
    expect(html).toContain("<strong>");
    cleanup();
  });
});

// ── Read-only / view mode ─────────────────────────────────────────────────────

describe("Editor — read-only mode", () => {
  function dispatchPaste(container: HTMLElement, text: string) {
    const ta = container.querySelector("textarea")!;
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    event.clipboardData!.setData("text/plain", text);
    ta.dispatchEvent(event);
  }

  it("readOnly is false by default", () => {
    const { editor, cleanup } = makeEditor();
    expect(editor.readOnly).toBe(false);
    cleanup();
  });

  it("readOnly option starts the editor in read-only mode", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = new Editor({ readOnly: true });
    editor.mount(container);
    expect(editor.readOnly).toBe(true);
    editor.destroy();
    container.remove();
  });

  it("setReadOnly(true) sets the flag and notifies subscribers", () => {
    const { editor, cleanup } = makeEditor();
    let notified = false;
    editor.subscribe(() => { notified = true; });
    editor.setReadOnly(true);
    expect(editor.readOnly).toBe(true);
    expect(notified).toBe(true);
    cleanup();
  });

  it("setReadOnly(false) clears the flag and notifies subscribers", () => {
    const { editor, cleanup } = makeEditor();
    editor.setReadOnly(true);
    let notified = false;
    editor.subscribe(() => { notified = true; });
    editor.setReadOnly(false);
    expect(editor.readOnly).toBe(false);
    expect(notified).toBe(true);
    cleanup();
  });

  it("setting the same value twice does not notify subscribers a second time", () => {
    const { editor, cleanup } = makeEditor();
    editor.setReadOnly(true);
    let count = 0;
    editor.subscribe(() => { count++; });
    editor.setReadOnly(true); // same value — should be a no-op
    expect(count).toBe(0);
    cleanup();
  });

  it("blocks typing when read-only", () => {
    const { editor, type, cleanup } = makeEditor();
    // First type some content to establish a baseline
    type("Hello");
    const before = editor.getState().doc.textContent;
    editor.setReadOnly(true);
    type(" world");
    expect(editor.getState().doc.textContent).toBe(before);
    cleanup();
  });

  it("blocks paste when read-only", () => {
    const { editor, container, cleanup } = makeEditor();
    editor.setReadOnly(true);
    dispatchPaste(container, "pasted text");
    expect(editor.getState().doc.textContent).toBe("");
    cleanup();
  });

  it("unblocks typing after setReadOnly(false)", () => {
    const { editor, type, cleanup } = makeEditor();
    editor.setReadOnly(true);
    type("blocked");
    expect(editor.getState().doc.textContent).toBe("");
    editor.setReadOnly(false);
    type("allowed");
    expect(editor.getState().doc.textContent).toBe("allowed");
    cleanup();
  });

  it("allows copy in read-only mode (does not throw)", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("copy me");
    editor.setReadOnly(true);
    const ta = container.querySelector("textarea")!;
    // Selecting all text so copy has something to work with
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    expect(() => ta.dispatchEvent(event)).not.toThrow();
    cleanup();
  });

  it("blocks cut mutation in read-only mode (content unchanged)", () => {
    const { editor, type, container, cleanup } = makeEditor();
    type("do not cut");
    editor.selection.setSelection(1, 11);
    const before = editor.getState().doc.textContent;
    editor.setReadOnly(true);
    const ta = container.querySelector("textarea")!;
    const event = new ClipboardEvent("cut", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    ta.dispatchEvent(event);
    expect(editor.getState().doc.textContent).toBe(before);
    cleanup();
  });
});

// ── Word boundary / selectWordAt / selectBlockAt ─────────────────────────────

describe("Editor — word boundary helpers", () => {
  it("selectWordAt selects a word in the middle of a sentence", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world foo");
    // Position inside "world" (h=1, e=2, l=3, l=4, o=5, ' '=6, w=7)
    const { from, to } = editor.selection.selectWordAt(8);
    const selected = editor.getState().doc.textBetween(from, to);
    expect(selected).toBe("world");
    cleanup();
  });

  it("selectWordAt selects the first word", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    const { from, to } = editor.selection.selectWordAt(2);
    const selected = editor.getState().doc.textBetween(from, to);
    expect(selected).toBe("hello");
    cleanup();
  });

  it("selectWordAt selects the last word", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    const { from, to } = editor.selection.selectWordAt(10);
    const selected = editor.getState().doc.textBetween(from, to);
    expect(selected).toBe("world");
    cleanup();
  });

  it("selectWordAt on whitespace selects nothing or adjacent word", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    // Position 6 is the space between hello and world
    const { from, to } = editor.selection.selectWordAt(6);
    // Word boundary scanning from a space: left scans past space to "hello",
    // right scans past space to "world" — result includes the space.
    // The exact behavior depends on the scanning algorithm; just verify
    // we don't crash and the selection is valid.
    expect(from).toBeGreaterThanOrEqual(1);
    expect(to).toBeLessThanOrEqual(12);
    cleanup();
  });

  it("selectBlockAt selects the entire paragraph", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.selectBlockAt(3);
    const sel = editor.getState().selection;
    expect(sel.from).toBe(1);
    expect(sel.to).toBe(12); // "hello world" = 11 chars, blockEnd = 12
    cleanup();
  });

  it("wordBoundary(-1) jumps left past a word", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    // From end of "world" (pos 12), scan left
    const pos = editor.selection.wordBoundary(12, -1);
    // Should land at start of "world" (pos 7)
    expect(pos).toBe(7);
    cleanup();
  });

  it("wordBoundary(1) jumps right past a word", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    // From start of "hello" (pos 1), scan right
    const pos = editor.selection.wordBoundary(1, 1);
    // Should land at end of "hello" (pos 6)
    expect(pos).toBe(6);
    cleanup();
  });
});

// ── Word navigation ──────────────────────────────────────────────────────────

describe("Editor — word navigation", () => {
  it("moveWordRight jumps to the end of the current word", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(1);
    editor.selection.moveWordRight();
    expect(editor.getState().selection.head).toBe(6); // end of "hello"
    cleanup();
  });

  it("moveWordLeft jumps to the start of the current word", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(12); // end of "world"
    editor.selection.moveWordLeft();
    expect(editor.getState().selection.head).toBe(7); // start of "world"
    cleanup();
  });

  it("moveWordRight(true) extends selection word-right", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(1);
    editor.selection.moveWordRight(true);
    const sel = editor.getState().selection;
    expect(sel.anchor).toBe(1);
    expect(sel.head).toBe(6);
    expect(sel.empty).toBe(false);
    cleanup();
  });

  it("moveWordLeft(true) extends selection word-left", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(12);
    editor.selection.moveWordLeft(true);
    const sel = editor.getState().selection;
    expect(sel.anchor).toBe(12);
    expect(sel.head).toBe(7);
    expect(sel.empty).toBe(false);
    cleanup();
  });
});

// ── Word delete ──────────────────────────────────────────────────────────────

describe("Editor — word delete", () => {
  it("deleteWordBackward removes the word before the cursor", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(6); // after "hello"
    editor.selection.deleteWordBackward();
    expect(editor.getState().doc.textContent).toBe(" world");
    cleanup();
  });

  it("deleteWordForward removes the word after the cursor", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(7); // start of "world"
    editor.selection.deleteWordForward();
    expect(editor.getState().doc.textContent).toBe("hello ");
    cleanup();
  });

  it("deleteWordBackward with a selection deletes the selection", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.setSelection(1, 6);
    editor.selection.deleteWordBackward();
    expect(editor.getState().doc.textContent).toBe(" world");
    cleanup();
  });
});

// ── Doc start / end navigation ───────────────────────────────────────────────

describe("Editor — doc start/end navigation", () => {
  it("moveToDocStart moves to the beginning of the document", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(8);
    editor.selection.moveToDocStart();
    expect(editor.getState().selection.head).toBe(1);
    cleanup();
  });

  it("moveToDocEnd moves to the end of the document", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello world");
    editor.selection.moveCursorTo(1);
    editor.selection.moveToDocEnd();
    expect(editor.getState().selection.head).toBe(12);
    cleanup();
  });

  it("moveToDocStart(true) extends selection to doc start", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello");
    editor.selection.moveCursorTo(4);
    editor.selection.moveToDocStart(true);
    const sel = editor.getState().selection;
    expect(sel.anchor).toBe(4);
    expect(sel.head).toBe(1);
    cleanup();
  });

  it("moveToDocEnd(true) extends selection to doc end", () => {
    const { editor, type, cleanup } = makeEditor();
    type("hello");
    editor.selection.moveCursorTo(2);
    editor.selection.moveToDocEnd(true);
    const sel = editor.getState().selection;
    expect(sel.anchor).toBe(2);
    expect(sel.head).toBe(6);
    cleanup();
  });
});
