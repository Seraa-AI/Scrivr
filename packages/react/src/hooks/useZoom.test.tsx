// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Editor, StarterKit, TextMeasurer, type TextMeasureContext } from "@scrivr/core";
// Through the package's barrel: these are what a host imports.
import { useZoom, useZoomRequest } from "../index";

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

function Shown({ editor }: { editor: Editor | null }) {
  return <span>{useZoom(editor)}</span>;
}

it("shows the factor the editor is zoomed to, as it changes", () => {
  const editor = new Editor({ extensions: [StarterKit], textMeasurer: new TextMeasurer({ context: fixedWidthContext }), zoom: 1.5 });
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Shown editor={editor} />));
  expect(host.textContent).toBe("1.5");

  act(() => editor.setZoom(0.75));
  expect(host.textContent).toBe("0.75");

  act(() => root.render(<Shown editor={null} />));
  expect(host.textContent).toBe("1");
  act(() => root.unmount());
  editor.destroy();
});

function Asked({ editor }: { editor: Editor | null }) {
  return <span>{String(useZoomRequest(editor))}</span>;
}

it("shows what was asked for, even when a new request shows the same factor", () => {
  const editor = new Editor({ extensions: [StarterKit], textMeasurer: new TextMeasurer({ context: fixedWidthContext }) });
  editor.setViewportSizeLookup(() => ({ width: editor.pageConfig.pageWidth, height: 800 }));
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Asked editor={editor} />));
  expect(host.textContent).toBe("1");

  // Fit width is 100% in this view: the factor holds, the request does not.
  act(() => editor.setZoom("fit-width"));
  expect(host.textContent).toBe("fit-width");

  act(() => root.render(<Asked editor={null} />));
  expect(host.textContent).toBe("1");
  act(() => root.unmount());
  editor.destroy();
});
