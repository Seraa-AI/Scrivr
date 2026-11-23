/**
 * `extend` makes a new extension from an existing one: hooks it declares layer
 * over the original's, and each can reach the original's result through
 * `this.parent`. Written against `@scrivr/core`'s public surface, the way a
 * host customises a built-in it finds limiting.
 */
import { describe, expect, it } from "vitest";
import { Bold, Extension, Heading, Paragraph, ServerEditor, StarterKit, type ExtendConfig, type Phase1Context } from "../index";

const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };

describe("Extension.extend", () => {
  it("changes one attribute of a built-in's node spec and keeps the rest", () => {
    const WithAnchor = Heading.extend({
      addNodes() {
        const nodes = this.parent?.() ?? {};
        const heading = nodes["heading"]!;
        return { ...nodes, heading: { ...heading, attrs: { ...heading.attrs, anchor: { default: null } } } };
      },
    });
    const editor = new ServerEditor({ extensions: [StarterKit.configure({ heading: false }), WithAnchor], content: doc });
    const spec = editor.getState().schema.nodes["heading"]!.spec;

    expect(spec.attrs).toHaveProperty("anchor");
    expect(spec.attrs).toHaveProperty("level");
    const tags = (rules: readonly { tag?: string }[] | undefined) => rules?.map((rule) => rule.tag);
    expect(tags(spec.parseDOM)).toEqual(tags(Heading.resolve().nodes["heading"]!.parseDOM));
  });

  it("adds a command beside the original's", () => {
    const Loud = Bold.extend({
      addCommands() {
        return { ...this.parent?.(), shout: () => () => true };
      },
    });
    const editor = new ServerEditor({ extensions: [StarterKit.configure({ bold: false }), Loud], content: doc });

    expect(Object.keys(Loud.resolve(editor.getState().schema).commands)).toEqual(
      expect.arrayContaining([...Object.keys(Bold.resolve(editor.getState().schema).commands), "shout"]),
    );
  });

  it("replaces a keymap outright when it does not call parent", () => {
    const Rebound = Bold.extend({ addKeymap() { return { "Mod-Shift-b": () => true }; } });
    const schema = new ServerEditor({ extensions: [StarterKit], content: doc }).getState().schema;

    expect(Object.keys(Rebound.resolve(schema).keymap)).toEqual(["Mod-Shift-b"]);
  });

  it("leaves a hook it does not declare as the original's", () => {
    const Renamed = Bold.extend({ name: "strong" });
    const schema = new ServerEditor({ extensions: [StarterKit], content: doc }).getState().schema;

    expect(Renamed.name).toBe("strong");
    expect(Object.keys(Renamed.resolve(schema).keymap)).toEqual(Object.keys(Bold.resolve(schema).keymap));
    expect(Bold.name).toBe("bold");
  });

  it("chains: each layer's parent is the one below it", () => {
    const calls: string[] = [];
    const Base = Extension.create({ name: "base", addToolbarItems() { calls.push("base"); return []; } });
    const Middle = Base.extend({ addToolbarItems() { calls.push("middle"); return this.parent?.() ?? []; } });
    const Top = Middle.extend({ addToolbarItems() { calls.push("top"); return this.parent?.() ?? []; } });
    Top.resolve();

    expect(calls).toEqual(["top", "middle", "base"]);
  });

  it("parent is undefined when the original has no such hook", () => {
    let parent: unknown = "unset";
    Extension.create({ name: "bare" }).extend({ addToolbarItems() { parent = this.parent; return []; } }).resolve();

    expect(parent).toBeUndefined();
  });

  it("merges options over the original's, and configure still applies after", () => {
    const seen: unknown[] = [];
    const Base = Extension.create<{ a: number; b: number }>({
      name: "opts",
      defaultOptions: { a: 1, b: 2 },
      addToolbarItems() { seen.push({ ...this.options }); return []; },
    });
    const Extended = Base.configure({ a: 5 }).extend<{ a: number; b: number; c: string }>({
      defaultOptions: { c: "x" },
      addToolbarItems() { seen.push(this.options.c); return this.parent?.() ?? []; },
    });
    Extended.configure({ b: 9 }).resolve();

    expect(seen).toEqual(["x", { a: 5, b: 9, c: "x" }]);
  });

  it("passes hook arguments to the override and on to parent", () => {
    const got: unknown[] = [];
    const Base = Extension.create({ name: "life", onEditorReady(editor) { got.push(["base", editor === undefined]); } });
    const Extended = Base.extend({ onEditorReady(editor) { got.push(["over", editor === undefined]); return this.parent?.(editor); } });
    new ServerEditor({ extensions: [StarterKit, Extended], content: doc });

    expect(got).toEqual([["over", false], ["base", false]]);
  });

  it("extends a bundle: StarterKit with one more child", () => {
    const Stamp = Extension.create({ name: "stamp", addMarks() { return { stamp: { toDOM: () => ["span", 0] } }; } });
    // The context most hooks run in is public, so a host can type a hook it writes apart.
    const context: Phase1Context | null = null;
    expect(context).toBeNull();
    const withStamp: ExtendConfig = { addExtensions() { return [...(this.parent?.() ?? []), Stamp]; } };
    const editor = new ServerEditor({ extensions: [StarterKit.extend(withStamp)], content: doc });

    expect(editor.getState().schema.marks["stamp"]).toBeDefined();
    expect(editor.getState().schema.marks["bold"]).toBeDefined();
  });

  it("a lifecycle override that returns parent's cleanup keeps it", () => {
    let cleaned = false;
    const Base = Extension.create({ name: "sub", onEditorReady() { return () => { cleaned = true; }; } });
    const Extended = Base.extend({ onEditorReady(editor) { return this.parent?.(editor); } });
    new ServerEditor({ extensions: [StarterKit, Extended], content: doc }).destroy();

    expect(cleaned).toBe(true);
  });

  it("replaces a StarterKit child in place, so Paragraph stays the default block", () => {
    const MyParagraph = Paragraph.extend({});
    const Kit = StarterKit.extend({
      addExtensions() {
        return (this.parent?.() ?? []).map((child) => (child.name === "paragraph" ? MyParagraph : child));
      },
    });
    const editor = new ServerEditor({ extensions: [Kit], content: doc });

    expect(editor.getState().schema.topNodeType.contentMatch.defaultType?.name).toBe("paragraph");
  });
});
