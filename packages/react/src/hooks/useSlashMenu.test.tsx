// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Editor, StarterKit, TextMeasurer, type TextMeasureContext } from "@scrivr/core";
// Through the package's barrel: this is what a host imports.
import { useSlashMenu } from "../index";

/** Nothing here reads a width: every glyph is 8px wide. */
const fixedWidthContext: TextMeasureContext = {
  font: "",
  measureText: (text) => ({
    width: text.length * 8,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 3,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * 8,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 4,
    alphabeticBaseline: 0,
    emHeightAscent: 12,
    emHeightDescent: 4,
    hangingBaseline: 10,
    ideographicBaseline: -4,
  }),
};

let menu: ReturnType<typeof useSlashMenu> | null = null;
function Listed({ editor }: { editor: Editor }) {
  menu = useSlashMenu(editor);
  return null;
}

it("gives each heading level its own glyph, and runs that level", () => {
  const editor = new Editor({ extensions: [StarterKit], textMeasurer: new TextMeasurer({ context: fixedWidthContext }) });
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Listed editor={editor} />));

  const glyphs = Object.fromEntries((menu?.items ?? []).map((item) => [item.id, item.label]));
  expect(glyphs).toMatchObject({ "heading.paragraph": "¶", "heading.1": "H1", "heading.2": "H2", "heading.3": "H3" });

  menu?.items.find((item) => item.id === "heading.3")?.action();
  const block = editor.getState().doc.firstChild;
  expect([block?.type.name, block?.attrs["level"]]).toEqual(["heading", 3]);

  act(() => root.unmount());
  editor.destroy();
});
