import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { PasteTransformer } from "./PasteTransformer";

/**
 * Word and Outlook do not emit `<ul>`/`<ol>`. A bulleted list arrives as a run
 * of `<p class=MsoListParagraph>` tagged with an `mso-list` style, each one
 * carrying its bullet glyph as literal text inside a span Word marks
 * `mso-list:Ignore` — precisely so consumers know to drop it. Pasted as-is,
 * that yields a stack of paragraphs each starting with a stray "·".
 *
 * These fixtures are trimmed from real Word clipboard output; the attribute
 * quoting (`class=MsoNormal`, single-quoted styles) is Word's own.
 */

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const schema = manager.schema;
  const state = EditorState.create({ schema, plugins: manager.buildPlugins() });
  const transformer = new PasteTransformer(
    schema,
    manager.buildMarkdownRules(),
    manager.buildMarkdownParserTokens(),
  );
  return { state, transformer };
}

function pasteWord(html: string): PMNode {
  const { state, transformer } = makeContext();
  const tr = transformer.transform(
    { getData: (key: string) => (key === "text/html" ? html : "") } as unknown as DataTransfer,
    state,
  );
  expect(tr).not.toBeNull();
  return state.apply(tr!).doc;
}

/**
 * Top-level block type names, in document order, minus a trailing empty
 * paragraph. A document may not end in a list, so the TrailingNode plugin adds
 * one after a pasted list — that is the schema's doing, not the paste's.
 */
function shape(doc: PMNode): string[] {
  const names: string[] = [];
  doc.content.forEach((n) => names.push(n.type.name));
  const last = doc.lastChild;
  if (last?.type.name === "paragraph" && last.content.size === 0) names.pop();
  return names;
}

/** A Word list paragraph: the marker span Word tells us to ignore, then the text. */
function wordListItem(marker: string, text: string, level = 1): string {
  return (
    `<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:l0 level${level} lfo1'>` +
    `<![if !supportLists]><span style='font-family:Symbol'>` +
    `<span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span>` +
    `</span><![endif]>${text}<o:p></o:p></p>`
  );
}

describe("Word HTML paste — noise elements", () => {
  it("drops Word's empty <o:p> paragraph markers", () => {
    const doc = pasteWord(`<p class=MsoNormal>Hello<o:p></o:p></p>`);

    expect(shape(doc)).toEqual(["paragraph"]);
    expect(doc.textContent).toBe("Hello");
  });

  it("leaves an ordinary MsoNormal paragraph alone", () => {
    const doc = pasteWord(
      `<p class=MsoNormal>First</p><p class=MsoNormal>Second</p>`,
    );

    expect(shape(doc)).toEqual(["paragraph", "paragraph"]);
    expect(doc.child(0).textContent).toBe("First");
    expect(doc.child(1).textContent).toBe("Second");
  });
});

describe("Word HTML paste — lists", () => {
  it("turns a run of bulleted list paragraphs into a real bulletList", () => {
    const doc = pasteWord(
      wordListItem("·", "First") + wordListItem("·", "Second"),
    );

    expect(shape(doc)).toEqual(["bulletList"]);
    const list = doc.child(0);
    expect(list.childCount).toBe(2);
    expect(list.child(0).textContent).toBe("First");
    expect(list.child(1).textContent).toBe("Second");
  });

  it("drops the literal bullet glyph Word marks mso-list:Ignore", () => {
    const doc = pasteWord(wordListItem("·", "Item"));

    expect(doc.textContent).toBe("Item");
    expect(doc.textContent).not.toContain("·");
  });

  it("turns numbered list paragraphs into an orderedList", () => {
    const doc = pasteWord(
      wordListItem("1.", "First") + wordListItem("2.", "Second"),
    );

    expect(shape(doc)).toEqual(["orderedList"]);
    expect(doc.child(0).childCount).toBe(2);
  });

  it("reads a lettered marker as ordered, but a bare 'o' bullet as unordered", () => {
    expect(shape(pasteWord(wordListItem("a.", "Item")))).toEqual(["orderedList"]);
    // Word's second-level bullet is a literal "o" in Courier New — a letter,
    // but not a numbering marker.
    expect(shape(pasteWord(wordListItem("o", "Item")))).toEqual(["bulletList"]);
  });

  it("nests a deeper level inside the item above it", () => {
    const doc = pasteWord(
      wordListItem("·", "Top", 1) +
        wordListItem("o", "Nested", 2) +
        wordListItem("·", "Back", 1),
    );

    const list = doc.child(0);
    expect(list.type.name).toBe("bulletList");
    expect(list.childCount).toBe(2);
    // The nested list lives inside the first item, after its paragraph.
    const firstItem = list.child(0);
    expect(firstItem.childCount).toBe(2);
    expect(firstItem.child(0).textContent).toBe("Top");
    expect(firstItem.child(1).type.name).toBe("bulletList");
    expect(firstItem.child(1).textContent).toBe("Nested");
    expect(list.child(1).textContent).toBe("Back");
  });

  it("keeps a paragraph between two list runs as its own separate lists", () => {
    const doc = pasteWord(
      wordListItem("·", "One") +
        `<p class=MsoNormal>Interlude</p>` +
        wordListItem("·", "Two"),
    );

    expect(shape(doc)).toEqual(["bulletList", "paragraph", "bulletList"]);
    expect(doc.child(1).textContent).toBe("Interlude");
  });

  it("keeps inline formatting inside a list item", () => {
    const html =
      `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>` +
      `<span style='mso-list:Ignore'>·</span>` +
      `plain <b>bold</b></p>`;
    const doc = pasteWord(html);

    const item = doc.child(0).child(0);
    expect(item.textContent).toBe("plain bold");
    const marks: string[] = [];
    item.descendants((n) => {
      n.marks.forEach((m) => marks.push(m.type.name));
    });
    expect(marks).toContain("bold");
  });
});

describe("Word HTML paste — list edge cases", () => {
  it("handles a list run that starts at a nested level", () => {
    // Copying from the middle of a Word list yields items whose first entry is
    // already indented, with no shallower item above to nest them under.
    const doc = pasteWord(
      wordListItem("o", "Deep first", 2) + wordListItem("o", "Deep second", 2),
    );

    expect(shape(doc)).toEqual(["bulletList"]);
    expect(doc.child(0).textContent).toBe("Deep firstDeep second");
  });

  it("ignores an mso-list style that carries no level", () => {
    const doc = pasteWord(
      `<p class=MsoNormal style='mso-list:none'>Not a list item</p>`,
    );

    expect(shape(doc)).toEqual(["paragraph"]);
    expect(doc.textContent).toBe("Not a list item");
  });
});
