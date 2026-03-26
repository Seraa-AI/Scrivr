import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { DOMParser as PMDOMParser } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { cleanPastedHtml } from "./PasteTransformer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const schema = manager.schema;
  const state = EditorState.create({ schema, plugins: manager.buildPlugins() });
  return { schema, state };
}

/** Parse an HTML string into a ProseMirror doc using the StarterKit schema. */
function parseHtml(html: string, schema: ReturnType<typeof makeContext>["schema"]) {
  const div = document.createElement("div");
  div.innerHTML = html;
  cleanPastedHtml(div);
  return PMDOMParser.fromSchema(schema).parse(div);
}

// ── cleanPastedHtml ───────────────────────────────────────────────────────────

describe("cleanPastedHtml", () => {
  it("unwraps Google Docs guid wrapper", () => {
    const root = document.createElement("div");
    root.innerHTML = `<b id="docs-internal-guid-abc123" style="font-weight:normal"><p>Hello</p></b>`;
    cleanPastedHtml(root);
    // The <b> wrapper should be gone; <p> should be a direct child
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector("p")?.textContent).toBe("Hello");
  });

  it("strips empty <p> elements immediately adjacent to <hr>", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      `<p>Content before</p>`,
      `<p><span></span></p>`,   // Google Docs spacer
      `<hr>`,
      `<p><span></span></p>`,   // Google Docs spacer
      `<h3>Section heading</h3>`,
    ].join("");
    cleanPastedHtml(root);
    // Empty paras adjacent to hr removed; real content preserved
    const tags = Array.from(root.children).map((el) => el.tagName.toLowerCase());
    expect(tags).toEqual(["p", "hr", "h3"]);
  });

  it("does not strip non-empty <p> elements adjacent to <hr>", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p>Above</p><hr><p>Below</p>`;
    cleanPastedHtml(root);
    const tags = Array.from(root.children).map((el) => el.tagName.toLowerCase());
    expect(tags).toEqual(["p", "hr", "p"]);
  });

  it("strips <style>, <meta>, and <link> elements", () => {
    const root = document.createElement("div");
    root.innerHTML = `<style>.c0{font-size:11pt}</style><meta charset="utf-8"><p>Text</p>`;
    cleanPastedHtml(root);
    expect(root.querySelector("style")).toBeNull();
    expect(root.querySelector("meta")).toBeNull();
    expect(root.querySelector("p")?.textContent).toBe("Text");
  });

  it("leaves non-Google-Docs <b> elements intact", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p>Hello <b>world</b></p>`;
    cleanPastedHtml(root);
    expect(root.querySelector("b")).not.toBeNull();
    expect(root.querySelector("b")?.textContent).toBe("world");
  });

  it("replaces non-breaking spaces with regular spaces", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p>Hello\u00a0world</p>`;
    cleanPastedHtml(root);
    expect(root.querySelector("p")?.textContent).toBe("Hello world");
  });

  it("handles nested elements with non-breaking spaces", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p><span>foo\u00a0</span><span>\u00a0bar</span></p>`;
    cleanPastedHtml(root);
    expect(root.textContent).toBe("foo  bar");
  });
});

// ── Paragraph parseDOM — align and fontFamily ─────────────────────────────────

describe("Paragraph parseDOM", () => {
  it("reads text-align from <p> style", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p style="text-align:center">Centered</p>`, schema);
    expect(doc.firstChild?.attrs["align"]).toBe("center");
  });

  it("defaults align to 'left' when not set", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p>No align</p>`, schema);
    expect(doc.firstChild?.attrs["align"]).toBe("left");
  });

  it("reads font-family from <p> style (block-level)", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p style="font-family:Arial,sans-serif">Text</p>`, schema);
    expect(doc.firstChild?.attrs["fontFamily"]).toBe("Arial");
  });

  it("strips quotes from font-family", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p style="font-family:'Times New Roman',serif">Text</p>`, schema);
    expect(doc.firstChild?.attrs["fontFamily"]).toBe("Times New Roman");
  });

  it("leaves fontFamily null when not set", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p>No font</p>`, schema);
    expect(doc.firstChild?.attrs["fontFamily"]).toBeNull();
  });
});

// ── Heading parseDOM — align and fontFamily ────────────────────────────────────

describe("Heading parseDOM", () => {
  it("reads text-align from <h1> style", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<h1 style="text-align:right">Title</h1>`, schema);
    expect(doc.firstChild?.attrs["align"]).toBe("right");
  });

  it("defaults align to 'left' for headings when not set", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<h2>Subtitle</h2>`, schema);
    expect(doc.firstChild?.attrs["align"]).toBe("left");
  });

  it("reads font-family from <h1> style", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<h1 style="font-family:Verdana,sans-serif">Title</h1>`, schema);
    expect(doc.firstChild?.attrs["fontFamily"]).toBe("Verdana");
  });

  it("parses all configured heading levels", () => {
    const { schema } = makeContext();
    for (const level of [1, 2, 3]) {
      const doc = parseHtml(
        `<h${level} style="text-align:center;font-family:Arial">H${level}</h${level}>`,
        schema,
      );
      expect(doc.firstChild?.attrs["level"]).toBe(level);
      expect(doc.firstChild?.attrs["align"]).toBe("center");
      expect(doc.firstChild?.attrs["fontFamily"]).toBe("Arial");
    }
  });
});

// ── font-size pt → px conversion ─────────────────────────────────────────────

describe("font-size pt → px conversion (via parseDOM)", () => {
  it("converts 11pt to ~15px (96/72 ratio)", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p><span style="font-size:11pt">text</span></p>`, schema);
    const sizeMark = doc.firstChild?.firstChild?.marks.find((m) => m.type.name === "font_size");
    // 11 * 96/72 = 14.666… → rounds to 15
    expect(sizeMark?.attrs["size"]).toBe(15);
  });

  it("converts 13pt to ~17px", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p><span style="font-size:13pt">text</span></p>`, schema);
    const sizeMark = doc.firstChild?.firstChild?.marks.find((m) => m.type.name === "font_size");
    // 13 * 96/72 = 17.333… → rounds to 17
    expect(sizeMark?.attrs["size"]).toBe(17);
  });

  it("keeps px values unchanged", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p><span style="font-size:16px">text</span></p>`, schema);
    const sizeMark = doc.firstChild?.firstChild?.marks.find((m) => m.type.name === "font_size");
    expect(sizeMark?.attrs["size"]).toBe(16);
  });

  it("converts 12pt (Word default) to 16px", () => {
    const { schema } = makeContext();
    const doc = parseHtml(`<p><span style="font-size:12pt">text</span></p>`, schema);
    const sizeMark = doc.firstChild?.firstChild?.marks.find((m) => m.type.name === "font_size");
    // 12 * 96/72 = 16 exactly
    expect(sizeMark?.attrs["size"]).toBe(16);
  });
});

// ── cleanPastedHtml — span noise stripping ───────────────────────────────────

describe("cleanPastedHtml — noise CSS stripping", () => {
  it("removes background-color from spans", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span style="background-color:transparent;font-weight:700">Bold</span>`;
    cleanPastedHtml(root);
    expect((root.querySelector("span") as HTMLElement).style.backgroundColor).toBe("");
    expect((root.querySelector("span") as HTMLElement).style.fontWeight).toBe("700");
  });

  it("removes white-space:pre from spans", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span style="white-space:pre-wrap;font-family:Arial">Text</span>`;
    cleanPastedHtml(root);
    expect((root.querySelector("span") as HTMLElement).style.whiteSpace).toBe("");
  });

  it("removes default color rgb(0,0,0)", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span style="color:rgb(0, 0, 0);font-weight:700">Text</span>`;
    cleanPastedHtml(root);
    expect((root.querySelector("span") as HTMLElement).style.color).toBe("");
    expect((root.querySelector("span") as HTMLElement).style.fontWeight).toBe("700");
  });

  it("keeps non-default color", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span style="color:rgb(255, 0, 0)">Red</span>`;
    cleanPastedHtml(root);
    expect((root.querySelector("span") as HTMLElement).style.color).toBe("rgb(255, 0, 0)");
  });

  it("removes line-height and margin from paragraph elements", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p style="line-height:1.38;margin-top:12pt;text-align:center">Text</p>`;
    cleanPastedHtml(root);
    const p = root.querySelector("p") as HTMLElement;
    expect(p.style.lineHeight).toBe("");
    expect(p.style.marginTop).toBe("");
    expect(p.style.textAlign).toBe("center"); // preserved
  });
});

// ── Google Docs round-trip ────────────────────────────────────────────────────

describe("Google Docs HTML paste (integration)", () => {
  it("unwraps guid wrapper and preserves paragraph text and align", () => {
    const { schema } = makeContext();
    const gdocsHtml = `
      <b id="docs-internal-guid-deadbeef" style="font-weight:normal">
        <p dir="ltr" style="line-height:1.38;text-align:center;margin-top:0pt">
          <span style="font-size:11pt;font-family:Arial,sans-serif;background-color:transparent">Hello world</span>
        </p>
      </b>
    `;
    const doc = parseHtml(gdocsHtml, schema);
    const para = doc.firstChild!;
    expect(para.type.name).toBe("paragraph");
    expect(para.attrs["align"]).toBe("center");
    // Google Docs puts font-family on <span>, not <p> — block fontFamily stays null;
    // the family is carried as an inline font_family mark on the text node instead.
    expect(para.attrs["fontFamily"]).toBeNull();
    // font_family mark normalises to the primary family name (fallbacks stripped)
    const familyMark = para.firstChild?.marks.find((m) => m.type.name === "font_family");
    expect(familyMark?.attrs["family"]).toBe("Arial");
    expect(para.textContent).toBe("Hello world");
  });

  it("normalises non-breaking spaces from Google Docs spans", () => {
    const { schema } = makeContext();
    const gdocsHtml = `<p><span>Hello\u00a0world</span></p>`;
    const doc = parseHtml(gdocsHtml, schema);
    expect(doc.firstChild?.textContent).toBe("Hello world");
  });

  it("parses multiple paragraphs each with their own align", () => {
    const { schema } = makeContext();
    const gdocsHtml = `
      <p style="text-align:center"><span>Title</span></p>
      <p style="text-align:justify"><span>Body</span></p>
      <p style="text-align:left"><span>Footer</span></p>
    `;
    const doc = parseHtml(gdocsHtml, schema);
    expect(doc.child(0).attrs["align"]).toBe("center");
    expect(doc.child(1).attrs["align"]).toBe("justify");
    expect(doc.child(2).attrs["align"]).toBe("left");
  });
});
