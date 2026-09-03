import { describe, it, expect } from "vitest";
import { DOMParser as PMDOMParser, DOMSerializer } from "prosemirror-model";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { Sections } from "./Sections";
import { buildStarterKitContext, createTestEditor } from "../../test-utils";
import { StarterKit } from "../StarterKit";
import {
  DEFAULT_SECTION_SETTINGS,
  FINAL_SECTION_ID,
  deriveSections,
} from "../../model/sections";
import type { Editor } from "../../Editor";

const { schema: fullSchema } = buildStarterKitContext();

function withEditor(run: (editor: Editor) => void, paragraphs = ["a", "b"]): void {
  const editor = createTestEditor({
    content: {
      type: "doc",
      content: paragraphs.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    },
  });
  try {
    run(editor);
  } finally {
    editor.destroy();
  }
}

/** Put the caret inside the first paragraph. */
function caretInFirstParagraph(editor: Editor): void {
  const state = editor.getState();
  editor.applyTransaction(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(1))),
  );
}

describe("Sections — schema", () => {
  const resolved = Sections.resolve(fullSchema);

  it("registers exactly one node: sectionBreak", () => {
    expect(Object.keys(resolved.nodes)).toEqual(["sectionBreak"]);
  });

  it("sectionBreak is a non-selectable block atom, like pageBreak", () => {
    const spec = resolved.nodes["sectionBreak"]!;
    expect(spec.group).toContain("block");
    expect(spec.atom).toBe(true);
    expect(spec.selectable).toBe(false);
  });

  it("declares a nodeId attr so UniqueId stamps section identity", () => {
    expect(resolved.nodes["sectionBreak"]!.attrs?.["nodeId"]?.default).toBe(null);
  });

  it("declares a finalSection doc attr defaulting to null", () => {
    expect(resolved.docAttrs["finalSection"]?.default).toBe(null);
  });

  it("round-trips nodeId and settings through DOM parse and serialize", () => {
    const div = document.createElement("div");
    div.innerHTML =
      '<div class="scrivr-section-break" data-node-id="sec-1" ' +
      "data-section-settings='{\"breakType\":\"continuous\",\"columns\":{\"count\":2,\"gap\":24,\"equalWidth\":true}}'></div>";
    const parsed = PMDOMParser.fromSchema(fullSchema).parse(div);

    let brk: Node | null = null;
    parsed.descendants((n) => {
      if (!brk && n.type.name === "sectionBreak") brk = n;
      return !brk;
    });
    expect(brk!.attrs["nodeId"]).toBe("sec-1");
    expect(deriveSections(parsed)[0]!.settings.columns.count).toBe(2);

    const out = document.createElement("div");
    out.appendChild(DOMSerializer.fromSchema(fullSchema).serializeFragment(parsed.content));
    const el = out.querySelector(".scrivr-section-break");
    expect(el?.getAttribute("data-node-id")).toBe("sec-1");
    expect(JSON.parse(el?.getAttribute("data-section-settings") ?? "{}").breakType).toBe(
      "continuous",
    );
  });
});

describe("Sections — insertSectionBreak", () => {
  it("splits the document into two sections", () => {
    withEditor((editor) => {
      expect(deriveSections(editor.getState().doc)).toHaveLength(1);
      caretInFirstParagraph(editor);
      editor.commands["insertSectionBreak"]!();
      expect(deriveSections(editor.getState().doc)).toHaveLength(2);
    });
  });

  it("copies the current section's settings onto the break, so both halves match", () => {
    withEditor((editor) => {
      editor.commands["setSectionSettings"]!(FINAL_SECTION_ID, { columns: { count: 3 } });
      caretInFirstParagraph(editor);
      editor.commands["insertSectionBreak"]!("continuous");

      const [first, final] = deriveSections(editor.getState().doc);
      expect(first!.settings.columns.count).toBe(3);
      expect(final!.settings.columns.count).toBe(3);
      expect(first!.settings.breakType).toBe("continuous");
    });
  });

  it("defaults to a next-page break", () => {
    withEditor((editor) => {
      caretInFirstParagraph(editor);
      editor.commands["insertSectionBreak"]!();
      expect(deriveSections(editor.getState().doc)[0]!.settings.breakType).toBe(
        DEFAULT_SECTION_SETTINGS.breakType,
      );
    });
  });

  it("gives the new section a stable id", () => {
    withEditor((editor) => {
      caretInFirstParagraph(editor);
      editor.commands["insertSectionBreak"]!();
      const [first] = deriveSections(editor.getState().doc);
      expect(first!.id).not.toBe(FINAL_SECTION_ID);
      expect(first!.id.startsWith("section:")).toBe(false);
    });
  });

  it("creates section identity even when UniqueId is disabled", () => {
    const editor = createTestEditor({
      extensions: [StarterKit.configure({ uniqueId: false })],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    try {
      caretInFirstParagraph(editor);
      editor.commands["insertSectionBreak"]!();

      const [first] = deriveSections(editor.getState().doc);
      expect(first!.id).toEqual(expect.any(String));
      expect(first!.id.startsWith("section:")).toBe(false);
    } finally {
      editor.destroy();
    }
  });
});

describe("Sections — setSectionSettings", () => {
  it("writes the final section's settings to the doc attr", () => {
    withEditor((editor) => {
      editor.commands["setSectionSettings"]!(FINAL_SECTION_ID, { columns: { count: 2, gap: 30 } });
      expect(editor.getState().doc.attrs["finalSection"]).toEqual({
        breakType: DEFAULT_SECTION_SETTINGS.breakType,
        columns: { count: 2, gap: 30, equalWidth: true },
      });
    });
  });

  it("writes an intermediate section's settings to its terminating break", () => {
    withEditor((editor) => {
      caretInFirstParagraph(editor);
      editor.commands["insertSectionBreak"]!();
      const id = deriveSections(editor.getState().doc)[0]!.id;

      editor.commands["setSectionSettings"]!(id, { columns: { count: 2 } });

      const sections = deriveSections(editor.getState().doc);
      expect(sections[0]!.settings.columns.count).toBe(2);
      expect(sections[1]!.settings.columns.count).toBe(1);
    });
  });

  it("is a no-op for an unknown section id", () => {
    withEditor((editor) => {
      editor.commands["setSectionSettings"]!("nope", { columns: { count: 2 } });
      expect(editor.getState().doc.attrs["finalSection"]).toBeNull();
    });
  });
});

describe("Sections — removeSectionBreak", () => {
  it("merges the section forward, adopting the following section's settings", () => {
    withEditor((editor) => {
      caretInFirstParagraph(editor);
      editor.commands["insertSectionBreak"]!();
      const [first] = deriveSections(editor.getState().doc);
      editor.commands["setSectionSettings"]!(first!.id, { columns: { count: 3 } });
      editor.commands["setSectionSettings"]!(FINAL_SECTION_ID, { columns: { count: 2 } });

      editor.commands["removeSectionBreak"]!(first!.id);

      const sections = deriveSections(editor.getState().doc);
      expect(sections).toHaveLength(1);
      expect(sections[0]!.settings.columns.count).toBe(2);
    });
  });

  it("leaves the document alone for the final section, which has no break", () => {
    withEditor((editor) => {
      const before = editor.getState().doc;
      editor.commands["removeSectionBreak"]!(FINAL_SECTION_ID);
      expect(editor.getState().doc.eq(before)).toBe(true);
    });
  });
});
