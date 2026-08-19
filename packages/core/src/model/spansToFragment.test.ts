/**
 * spansToFragment / sameMark — the write half of Rich Semantic Merge.
 *
 * The agent returns rich inline runs (`InlineSpan[]`); this rebuilds a PM
 * Fragment. Agent output is untrusted, so the guards (empty run, newline
 * sentinel, unknown mark, unsafe url, bad attrs) are the safety net that keeps
 * a malformed edit from crashing the merge or poisoning the document.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { spansToFragment, sameMark } from "./spansToFragment";
import type { InlineSpan } from "../exports/semantic";

function schema() {
  return new ServerEditor({}).schema;
}

/** Flatten a fragment to `[text, markTypeNames]` pairs for assertions. */
function runsOf(fragment: ReturnType<typeof spansToFragment>) {
  const runs: Array<{ text: string; marks: string[] }> = [];
  fragment.forEach((node) => {
    runs.push({ text: node.text ?? "", marks: node.marks.map((m) => m.type.name).sort() });
  });
  return runs;
}

describe("spansToFragment", () => {
  it("rebuilds marked runs from spans", () => {
    const s = schema();
    const spans: InlineSpan[] = [
      { text: "The ", marks: [] },
      { text: "Provider", marks: [{ type: "bold" }] },
      { text: " shall pay.", marks: [] },
    ];
    expect(runsOf(spansToFragment(spans, s))).toEqual([
      { text: "The ", marks: [] },
      { text: "Provider", marks: ["bold"] },
      { text: " shall pay.", marks: [] },
    ]);
  });

  it("carries mark attrs (color)", () => {
    const s = schema();
    const frag = spansToFragment([{ text: "x", marks: [{ type: "color", attrs: { color: "#dc2626" } }] }], s);
    const mark = frag.firstChild!.marks[0]!;
    expect(mark.type.name).toBe("color");
    expect(mark.attrs["color"]).toBe("#dc2626");
  });

  it("skips empty-text runs (schema.text('') throws)", () => {
    const s = schema();
    const frag = spansToFragment([{ text: "", marks: [{ type: "bold" }] }, { text: "kept", marks: [] }], s);
    expect(runsOf(frag)).toEqual([{ text: "kept", marks: [] }]);
  });

  it("drops the NEWLINE_SPAN sentinel", () => {
    const s = schema();
    // "a" and "b" carry no marks, so PM merges them into one canonical run.
    const frag = spansToFragment([{ text: "a", marks: [] }, { text: "\n", marks: [] }, { text: "b", marks: [] }], s);
    expect(runsOf(frag)).toEqual([{ text: "ab", marks: [] }]);
  });

  it("drops an unknown mark but keeps the text, warning once", () => {
    const s = schema();
    const warnings: string[] = [];
    const frag = spansToFragment(
      [
        { text: "one", marks: [{ type: "sparkle" }] },
        { text: "two", marks: [{ type: "sparkle" }] },
      ],
      s,
      { onWarn: (m) => warnings.push(m) },
    );
    // Both runs lose the unknown mark, become unmarked, and PM merges them.
    expect(runsOf(frag)).toEqual([{ text: "onetwo", marks: [] }]);
    expect(warnings).toHaveLength(1); // warned once for "sparkle", not per run
    expect(warnings[0]).toContain("sparkle");
  });

  it("sanitizes a link href through safeUrl (drops mark on javascript:)", () => {
    const s = schema();
    const frag = spansToFragment(
      [{ text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
      s,
    );
    expect(runsOf(frag)).toEqual([{ text: "click", marks: [] }]); // mark dropped, text kept
  });

  it("keeps a safe link href", () => {
    const s = schema();
    const frag = spansToFragment(
      [{ text: "click", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
      s,
    );
    const mark = frag.firstChild!.marks[0]!;
    expect(mark.type.name).toBe("link");
    expect(mark.attrs["href"]).toBe("https://example.com");
  });
});

describe("sameMark", () => {
  it("equal when type and attrs canonicalize identically", () => {
    expect(sameMark({ type: "bold" }, { type: "bold" })).toBe(true);
    expect(sameMark({ type: "bold" }, { type: "bold", attrs: {} })).toBe(true);
    expect(
      sameMark(
        { type: "color", attrs: { color: "#f00", weight: 1 } },
        { type: "color", attrs: { weight: 1, color: "#f00" } }, // reordered keys
      ),
    ).toBe(true);
  });

  it("differs on type or attr value", () => {
    expect(sameMark({ type: "bold" }, { type: "italic" })).toBe(false);
    expect(
      sameMark({ type: "color", attrs: { color: "#fff" } }, { type: "color", attrs: { color: "#ffffff" } }),
    ).toBe(false);
  });
});
