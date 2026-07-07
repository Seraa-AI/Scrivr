/**
 * Structured formatting — `spans` (inline marks with attrs) and `attrs` (block
 * styling markdown can't express). The lossless source of truth for formatting.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../index";
import type { SemanticUnit } from "@scrivr/core";

function edit(content: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit], content });
}
const mk = (text: string, ...marks: unknown[]) => ({
  type: "text",
  text,
  ...(marks.length ? { marks } : {}),
});
const only = (content: unknown[]): SemanticUnit =>
  toSemanticUnits(edit({ type: "doc", content }))[0]!;

describe("spans — inline formatting", () => {
  it("emits a span per run with its formatting marks and attrs", () => {
    const u = only([
      {
        type: "paragraph",
        content: [
          mk("plain "),
          mk("bold", { type: "bold" }),
          mk(" "),
          mk("red", { type: "bold" }, { type: "color", attrs: { color: "#f00" } }),
          mk(" "),
          mk("link", { type: "link", attrs: { href: "https://x" } }),
        ],
      },
    ]);
    expect(u.spans).toEqual([
      { text: "plain ", marks: [] },
      { text: "bold", marks: [{ type: "bold" }] },
      { text: " ", marks: [] },
      { text: "red", marks: [{ type: "bold" }, { type: "color", attrs: { color: "#f00" } }] },
      { text: " ", marks: [] },
      { text: "link", marks: [{ type: "link", attrs: { href: "https://x" } }] },
    ]);
  });

  it("reconstructs text exactly (spans join === text)", () => {
    const u = only([
      { type: "paragraph", content: [mk("a"), mk("b", { type: "italic" }), mk("c")] },
    ]);
    expect(u.spans!.map((s) => s.text).join("")).toBe(u.text);
  });

  it("omits spans for a fully unformatted unit", () => {
    const u = only([{ type: "paragraph", content: [mk("just plain text")] }]);
    expect(u.spans).toBeUndefined();
  });

  it("keeps a hard break as a newline span", () => {
    const u = only([
      { type: "paragraph", content: [mk("one", { type: "bold" }), { type: "hardBreak" }, mk("two")] },
    ]);
    expect(u.spans).toEqual([
      { text: "one", marks: [{ type: "bold" }] },
      { text: "\n", marks: [] },
      { text: "two", marks: [] },
    ]);
    expect(u.spans!.map((s) => s.text).join("")).toBe(u.text);
  });
});

describe("attrs — block styling markdown can't express", () => {
  it("surfaces non-default alignment and indent", () => {
    const u = only([
      { type: "paragraph", attrs: { align: "center", indent: 2 }, content: [mk("centered")] },
    ]);
    expect(u.attrs).toMatchObject({ align: "center", indent: 2 });
  });

  it("omits attrs for a default-styled block", () => {
    const u = only([{ type: "paragraph", content: [mk("default")] }]);
    expect(u.attrs).toBeUndefined();
  });

  it("never leaks nodeId, dataTracked, or level into attrs", () => {
    const u = only([
      { type: "heading", attrs: { level: 3, align: "right", nodeId: "h1" }, content: [mk("x")] },
    ]);
    expect(u.attrs).toEqual({ align: "right" }); // level → headingLevel; nodeId → id
    expect(u.headingLevel).toBe(3);
    expect(u.id).toBe("h1");
  });
});
