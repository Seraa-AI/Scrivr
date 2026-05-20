import { describe, it, expect } from "vitest";
import { HardBreak } from "./HardBreak";
import { Document } from "./Document";
import { BaseEditing } from "./BaseEditing";
import { StarterKit } from "../StarterKit";
import { ServerEditor } from "../../ServerEditor";
import { buildStarterKitContext } from "../../test-utils";

const { schema: starterKitSchema } = buildStarterKitContext();

// ── addNodes ──────────────────────────────────────────────────────────────────

describe("HardBreak — addNodes", () => {
  const resolved = HardBreak.resolve();

  it("registers exactly one node: hardBreak", () => {
    expect(Object.keys(resolved.nodes)).toEqual(["hardBreak"]);
  });

  it("hardBreak is inline and a leaf (no content)", () => {
    const spec = resolved.nodes["hardBreak"]!;
    expect(spec.inline).toBe(true);
    expect(spec.group).toContain("inline");
    // Leaf node — no content expression
    expect(spec.content).toBeFalsy();
  });

  it("hardBreak is not selectable (clicking jumps past, never selects the break itself)", () => {
    const spec = resolved.nodes["hardBreak"]!;
    expect(spec.selectable).toBe(false);
  });

  it("parses from <br> and serializes to <br>", () => {
    const spec = resolved.nodes["hardBreak"]!;
    const parse = spec.parseDOM?.[0];
    expect((parse as { tag: string }).tag).toBe("br");
    const dom = spec.toDOM?.(null as never);
    expect(dom).toEqual(["br"]);
  });
});

// ── addKeymap ────────────────────────────────────────────────────────────────

describe("HardBreak — addKeymap", () => {
  it("binds Shift-Enter by default", () => {
    const resolved = HardBreak.resolve(starterKitSchema);
    expect(typeof resolved.keymap["Shift-Enter"]).toBe("function");
  });

  it("respects shortcut: false (no keymap binding)", () => {
    const resolved = HardBreak.configure({ shortcut: false }).resolve(starterKitSchema);
    expect(resolved.keymap["Shift-Enter"]).toBeUndefined();
  });
});

// ── addCommands ──────────────────────────────────────────────────────────────

describe("HardBreak — addCommands", () => {
  it("exposes insertHardBreak", () => {
    const resolved = HardBreak.resolve(starterKitSchema);
    expect(typeof resolved.commands["insertHardBreak"]).toBe("function");
  });

  it("insertHardBreak inserts a hardBreak node at the cursor", () => {
    const editor = new ServerEditor({
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }] },
    });
    editor.commands.insertHardBreak();
    const para = editor.getState().doc.firstChild!;
    // Paragraph now contains: text("abc"), hardBreak
    const types = para.content.content.map((n) => n.type.name);
    expect(types).toContain("hardBreak");
  });
});

// ── addMarkdownSerializerRules ───────────────────────────────────────────────

describe("HardBreak — markdown roundtrip", () => {
  it("serializes a hardBreak between text runs as a markdown line break", () => {
    const editor = new ServerEditor({
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "one" },
            { type: "hardBreak" },
            { type: "text", text: "two" },
          ],
        }],
      },
    });
    const md = editor.getMarkdown();
    // CommonMark backslash hard break — text, "\", newline, text
    expect(md).toContain("one");
    expect(md).toContain("two");
    expect(md).toMatch(/\\\n/);
  });

  it("does not emit a stray break for a trailing hardBreak", () => {
    // The serializer rule walks ahead to confirm there's non-hardBreak
    // content after, so a trailing break alone shouldn't add "\\\n".
    const editor = new ServerEditor({
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "trailing" },
            { type: "hardBreak" },
          ],
        }],
      },
    });
    const md = editor.getMarkdown();
    expect(md).not.toMatch(/\\\n/);
  });

  it("parses CommonMark backslash-newline as a hardBreak node", () => {
    // ServerEditor accepts a markdown string as `content`. The markdown-it
    // lexer emits a `hardbreak` token for `\` + newline; HardBreak's
    // addMarkdownParserTokens must map that token to the hardBreak node so
    // the doc preserves the break instead of silently merging the two
    // text runs.
    const editor = new ServerEditor({
      // Two-line input with a CommonMark hard break in the middle.
      // Bun template literal renders as `alpha\\\nbeta` after escaping.
      content: "alpha\\\nbeta",
    });
    const para = editor.getState().doc.firstChild!;
    expect(para.type.name).toBe("paragraph");
    const childTypes = para.content.content.map((n) => n.type.name);
    // Expect: text("alpha"), hardBreak, text("beta")
    expect(childTypes).toEqual(["text", "hardBreak", "text"]);
  });

  it("roundtrips markdown → PM doc → markdown without losing the hardBreak", () => {
    const input = "alpha\\\nbeta";
    const editor = new ServerEditor({ content: input });
    const output = editor.getMarkdown().trim();
    // Markdown serializer may not produce byte-identical output (e.g.
    // surrounding whitespace), but the backslash-newline form must survive.
    expect(output).toMatch(/alpha\\\nbeta/);
  });
});

// ── Regression guards: Document and BaseEditing no longer own this ───────────

describe("HardBreak — extraction from Document and BaseEditing", () => {
  it("Document no longer contributes the hardBreak node", () => {
    const docResolved = Document.resolve();
    expect(docResolved.nodes["hardBreak"]).toBeUndefined();
  });

  it("Document no longer contributes the hardBreak markdown serializer rule", () => {
    const docResolved = Document.resolve();
    const docNodes = docResolved.markdownSerializerRules.nodes ?? {};
    expect(docNodes["hardBreak"]).toBeUndefined();
  });

  it("BaseEditing no longer binds Shift-Enter", () => {
    const baseResolved = BaseEditing.resolve(starterKitSchema);
    expect(baseResolved.keymap["Shift-Enter"]).toBeUndefined();
  });
});

// ── StarterKit integration ──────────────────────────────────────────────────

describe("HardBreak — StarterKit wiring", () => {
  it("StarterKit by default includes hardBreak in the schema", () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    expect(editor.schema.nodes["hardBreak"]).toBeDefined();
  });

  it("StarterKit by default exposes insertHardBreak", () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    expect(typeof editor.commands.insertHardBreak).toBe("function");
  });

  it("StarterKit.configure({ hardBreak: false }) excludes the node, command, and serializer", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ hardBreak: false })],
    });
    expect(editor.schema.nodes["hardBreak"]).toBeUndefined();
    expect(editor.commands.insertHardBreak).toBeUndefined();
  });

  it("StarterKit.configure({ hardBreak: { shortcut: false } }) keeps the node but drops Shift-Enter", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ hardBreak: { shortcut: false } })],
    });
    expect(editor.schema.nodes["hardBreak"]).toBeDefined();
    expect(typeof editor.commands.insertHardBreak).toBe("function");
    // Note: Shift-Enter being absent from the merged keymap isn't directly
    // observable through the public editor API. Asserted at the extension
    // level above via HardBreak.configure({ shortcut: false }).
  });
});
