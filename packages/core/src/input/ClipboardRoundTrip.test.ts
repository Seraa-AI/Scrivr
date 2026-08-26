import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node as PMNode, Schema } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { serializeSelectionToHtml, serializeSelectionToText } from "./ClipboardSerializer";
import { PasteTransformer } from "./PasteTransformer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const schema = manager.schema;
  const plugins = manager.buildPlugins();
  const transformer = new PasteTransformer(
    schema,
    manager.buildMarkdownRules(),
    manager.buildMarkdownParserTokens(),
  );
  return { schema, plugins, transformer };
}

function stateWith(
  schema: Schema,
  plugins: ReturnType<ExtensionManager["buildPlugins"]>,
  blocks: PMNode[],
): EditorState {
  return EditorState.create({ schema, doc: schema.node("doc", null, blocks), plugins });
}

function para(schema: Schema, text: string, attrs: Record<string, unknown> | null = null): PMNode {
  return schema.node("paragraph", attrs, text ? [schema.text(text)] : []);
}

function at(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function select(state: EditorState, from: number, to: number): EditorState {
  return state.apply(
    state.tr.setSelection(TextSelection.between(state.doc.resolve(from), state.doc.resolve(to))),
  );
}

/** A DataTransfer stub carrying only the formats a real clipboard would hold. */
function clipboard(data: Record<string, string>): DataTransfer {
  const get = (key: string): string => data[key] ?? "";
  return { getData: get } as unknown as DataTransfer;
}

/** Paste `data` into `state` and return the resulting document. */
function paste(
  transformer: PasteTransformer,
  state: EditorState,
  data: Record<string, string>,
): PMNode {
  const tr = transformer.transform(clipboard(data), state);
  expect(tr).not.toBeNull();
  return state.apply(tr!).doc;
}

/** Block type names in document order — the structural shape of a paste result. */
function shape(doc: PMNode): string[] {
  const names: string[] = [];
  doc.content.forEach((n) => names.push(n.type.name));
  return names;
}

/** Copy the current selection the way `handleCopy` does, as clipboard payloads. */
function copy(state: EditorState, schema: Schema): Record<string, string> {
  const html = serializeSelectionToHtml(state, schema);
  const text = serializeSelectionToText(state);
  const data: Record<string, string> = {};
  if (text !== null) data["text/plain"] = text;
  if (html !== null) data["text/html"] = html;
  return data;
}

// ── Internal round-trip: copy out of the editor, paste back in ────────────────

describe("clipboard round-trip — same-editor copy and paste", () => {
  it("pastes an inline copy back inline instead of splitting the paragraph", () => {
    const { schema, plugins, transformer } = makeContext();
    // Copy "big " out of "a big cat", then paste it after "a " in a fresh doc.
    const source = select(stateWith(schema, plugins, [para(schema, "a big cat")]), 3, 7);
    const payload = copy(source, schema);

    const target = at(stateWith(schema, plugins, [para(schema, "a cat")]), 3);
    const doc = paste(transformer, target, payload);

    expect(shape(doc)).toEqual(["paragraph"]);
    expect(doc.textContent).toBe("a big cat");
  });

  it("keeps marks on an inline copy", () => {
    const { schema, plugins, transformer } = makeContext();
    let source = stateWith(schema, plugins, [para(schema, "bold text")]);
    source = source.apply(source.tr.addMark(1, 5, schema.marks["bold"]!.create()));
    source = select(source, 1, 5);
    const payload = copy(source, schema);

    const target = at(stateWith(schema, plugins, [para(schema, "")]), 1);
    const doc = paste(transformer, target, payload);

    expect(doc.textContent).toBe("bold");
    const text = doc.firstChild!.firstChild!;
    expect(text.marks.map((m) => m.type.name)).toContain("bold");
  });

  it("preserves each block's own align across a multi-block round-trip", () => {
    const { schema, plugins, transformer } = makeContext();
    const source = select(
      stateWith(schema, plugins, [
        para(schema, "centered", { align: "center" }),
        para(schema, "righted", { align: "right" }),
      ]),
      1,
      19,
    );
    const payload = copy(source, schema);

    const target = at(stateWith(schema, plugins, [para(schema, "")]), 1);
    const doc = paste(transformer, target, payload);

    expect(shape(doc)).toEqual(["paragraph", "paragraph"]);
    expect(doc.child(0).attrs["align"]).toBe("center");
    expect(doc.child(1).attrs["align"]).toBe("right");
  });

  it("preserves heading level and fontFamily across a round-trip", () => {
    const { schema, plugins, transformer } = makeContext();
    const heading = schema.node("heading", { level: 2, fontFamily: "Verdana" }, [
      schema.text("Title"),
    ]);
    const source = select(
      stateWith(schema, plugins, [heading, para(schema, "body")]),
      0,
      13,
    );
    const payload = copy(source, schema);

    const target = at(stateWith(schema, plugins, [para(schema, "")]), 1);
    const doc = paste(transformer, target, payload);

    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(0).attrs["level"]).toBe(2);
    expect(doc.child(0).attrs["fontFamily"]).toBe("Verdana");
  });

  it("preserves list structure across a round-trip", () => {
    const { schema, plugins, transformer } = makeContext();
    const item = (t: string): PMNode =>
      schema.node("listItem", null, [para(schema, t)]);
    const list = schema.node("bulletList", null, [item("one"), item("two")]);
    const listDoc = stateWith(schema, plugins, [list, para(schema, "")]);
    const source = select(listDoc, 0, listDoc.doc.content.size);
    const payload = copy(source, schema);

    const target = at(stateWith(schema, plugins, [para(schema, "")]), 1);
    const doc = paste(transformer, target, payload);

    expect(shape(doc)).toContain("bulletList");
    const pastedList = doc.child(0);
    expect(pastedList.childCount).toBe(2);
    expect(pastedList.textContent).toBe("onetwo");
  });
});

// ── External HTML: openness derived from the pasted shape ─────────────────────

describe("paste openness — external HTML", () => {
  it("merges an inline-only fragment into the cursor's paragraph", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "Hello world")]), 6);
    const doc = paste(transformer, target, { "text/html": "<span>BIG </span>" });

    expect(shape(doc)).toEqual(["paragraph"]);
    // Foreign HTML gets standard whitespace collapsing, so "BIG " loses its
    // trailing space — unlike an internal slice, where the space is content.
    expect(doc.textContent).toBe("HelloBIG world");
  });

  it("merges a single plain paragraph into the cursor's paragraph", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "Hello world")]), 6);
    const doc = paste(transformer, target, { "text/html": "<p>BIG</p>" });

    expect(shape(doc)).toEqual(["paragraph"]);
    expect(doc.textContent).toBe("HelloBIG world");
  });

  it("keeps a paragraph that carries non-default attrs as its own block", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "Hello world")]), 6);
    const doc = paste(transformer, target, {
      "text/html": `<p style="text-align:center">Centered</p>`,
    });

    expect(shape(doc)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(doc.child(1).attrs["align"]).toBe("center");
  });

  it("merges the first and last of several plain paragraphs, keeping the middle", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "Hello world")]), 6);
    const doc = paste(transformer, target, {
      "text/html": "<p>one</p><p>two</p><p>three</p>",
    });

    expect(shape(doc)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(doc.child(0).textContent).toBe("Helloone");
    expect(doc.child(1).textContent).toBe("two");
    expect(doc.child(2).textContent).toBe("three world");
  });

  it("replaces an empty paragraph rather than leaving it before the pasted blocks", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "")]), 1);
    const doc = paste(transformer, target, {
      "text/html": `<p style="text-align:center">Centered</p>`,
    });

    expect(shape(doc)).toEqual(["paragraph"]);
    expect(doc.child(0).attrs["align"]).toBe("center");
  });

  it("keeps a heading as its own block when pasted mid-paragraph", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "Hello world")]), 6);
    const doc = paste(transformer, target, { "text/html": "<h1>Title</h1>" });

    expect(shape(doc)).toEqual(["paragraph", "heading", "paragraph"]);
    expect(doc.child(1).textContent).toBe("Title");
  });
});

// ── Placement attrs are foreign input on the way in ───────────────────────────

describe("pasted image placement attrs", () => {
  function pasteImage(html: string): PMNode {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "")]), 1);
    const tr = transformer.transform(clipboard({ "text/html": html }), target);
    expect(tr).not.toBeNull();
    return target.apply(tr!).doc;
  }

  function firstImage(doc: PMNode): PMNode | undefined {
    let found: PMNode | undefined;
    doc.descendants((node) => {
      if (!found && node.type.name === "image") found = node;
    });
    return found;
  }

  const SRC = "https://example.com/a.png";

  it("keeps a wrap mode that the layout engine knows", () => {
    const img = firstImage(
      pasteImage(`<img src="${SRC}" data-wrap-mode="square" data-x-align="center">`),
    );
    expect(img!.attrs["wrapMode"]).toBe("square");
    expect(img!.attrs["xAlign"]).toBe("center");
  });

  it("falls back to the default for a wrap mode outside the enum", () => {
    // PageLayout treats any wrapMode that is not "inline" as an anchored
    // object, so an unrecognised one would lay out as a float no wrap branch
    // handles. Foreign HTML must not be able to put one in the document.
    const img = firstImage(pasteImage(`<img src="${SRC}" data-wrap-mode="bogus">`));
    expect(img!.attrs["wrapMode"]).toBe("inline");
  });

  it("falls back to the default for an alignment outside the enum", () => {
    const img = firstImage(
      pasteImage(`<img src="${SRC}" data-wrap-mode="square" data-x-align="sideways">`),
    );
    expect(img!.attrs["xAlign"]).toBe("left");
  });

  it("ignores a non-numeric or negative placement distance", () => {
    const img = firstImage(
      pasteImage(`<img src="${SRC}" data-margin="-40" data-z-index="abc">`),
    );
    expect(img!.attrs["margin"]).toBe(12);
    expect(img!.attrs["zIndex"]).toBe(0);
  });

  it("keeps a negative offset, which is a direction rather than a distance", () => {
    const img = firstImage(
      pasteImage(`<img src="${SRC}" data-wrap-mode="square" data-y-offset="-30">`),
    );
    expect(img!.attrs["yOffset"]).toBe(-30);
  });
});

describe("recorded slice openness is untrusted input", () => {
  it("ignores negative open depths from a hostile page", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "Hello world")]), 6);
    const doc = paste(transformer, target, {
      "text/html": `<div data-pm-slice="-5 -5 []"><p>x</p></div>`,
    });

    expect(doc.textContent).toContain("x");
  });

  it("ignores open depths deeper than the pasted content", () => {
    const { schema, plugins, transformer } = makeContext();
    const target = at(stateWith(schema, plugins, [para(schema, "Hello world")]), 6);
    const doc = paste(transformer, target, {
      "text/html": `<div data-pm-slice="99 99 []"><p>x</p></div>`,
    });

    expect(doc.textContent).toContain("x");
  });
});
