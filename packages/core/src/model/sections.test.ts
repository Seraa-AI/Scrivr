import { describe, it, expect } from "vitest";
import {
  DEFAULT_SECTION_SETTINGS,
  FINAL_SECTION_ID,
  coerceSectionSettings,
  deriveSections,
  isSectionSettings,
  sectionAt,
} from "./sections";
import { doc, paragraph as p, sectionBreak } from "../test-utils";

describe("coerceSectionSettings", () => {
  it("returns defaults for null/undefined", () => {
    expect(coerceSectionSettings(null)).toEqual(DEFAULT_SECTION_SETTINGS);
    expect(coerceSectionSettings(undefined)).toEqual(DEFAULT_SECTION_SETTINGS);
  });

  it("fills missing keys from defaults", () => {
    expect(coerceSectionSettings({ breakType: "continuous" })).toEqual({
      ...DEFAULT_SECTION_SETTINGS,
      breakType: "continuous",
    });
  });

  it("drops invalid values instead of propagating them", () => {
    expect(coerceSectionSettings({ breakType: "sideways" })).toEqual(DEFAULT_SECTION_SETTINGS);
    expect(coerceSectionSettings({ columns: { count: 0, gap: -5 } })).toEqual(
      DEFAULT_SECTION_SETTINGS,
    );
  });

  it("keeps valid column settings", () => {
    expect(coerceSectionSettings({ columns: { count: 3, gap: 12 } }).columns).toEqual({
      count: 3,
      gap: 12,
      equalWidth: true,
    });
  });

  it("rounds a fractional column count down to a whole number of columns", () => {
    expect(coerceSectionSettings({ columns: { count: 2.7, gap: 12 } }).columns.count).toBe(2);
  });
});

describe("isSectionSettings", () => {
  it("accepts the default shape", () => {
    expect(isSectionSettings(DEFAULT_SECTION_SETTINGS)).toBe(true);
  });

  it("rejects partial or malformed shapes", () => {
    expect(isSectionSettings(null)).toBe(false);
    expect(isSectionSettings({ breakType: "nextPage" })).toBe(false);
    expect(isSectionSettings({ ...DEFAULT_SECTION_SETTINGS, breakType: "x" })).toBe(false);
  });
});

describe("deriveSections", () => {
  it("returns one section for a document with no breaks", () => {
    const sections = deriveSections(doc(p("a"), p("b")));
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe(FINAL_SECTION_ID);
    expect(sections[0]!.breakPos).toBeNull();
    expect(sections[0]!.settings).toEqual(DEFAULT_SECTION_SETTINGS);
  });

  it("spans the whole document for the single-section case", () => {
    const d = doc(p("a"), p("b"));
    const [only] = deriveSections(d);
    expect(only!.from).toBe(0);
    expect(only!.to).toBe(d.content.size);
  });

  it("splits at a break, and the break belongs to the section it terminates", () => {
    const d = doc(p("a"), sectionBreak(), p("b"));
    const sections = deriveSections(d);
    expect(sections).toHaveLength(2);

    const breakPos = d.child(0).nodeSize;
    expect(sections[0]!.breakPos).toBe(breakPos);
    expect(sections[0]!.from).toBe(0);
    expect(sections[0]!.to).toBe(breakPos + d.child(1).nodeSize);
    expect(sections[1]!.from).toBe(sections[0]!.to);
    expect(sections[1]!.to).toBe(d.content.size);
  });

  it("takes each section's settings from its terminating break", () => {
    const d = doc(
      p("a"),
      sectionBreak({ breakType: "continuous", columns: { count: 2, gap: 24, equalWidth: true } }),
      p("b"),
    );
    const [first, final] = deriveSections(d);
    expect(first!.settings.breakType).toBe("continuous");
    expect(first!.settings.columns.count).toBe(2);
    expect(final!.settings).toEqual(DEFAULT_SECTION_SETTINGS);
  });

  it("reads the final section's settings from doc.attrs.finalSection", () => {
    const d = doc(p("a"));
    const withAttrs = d.type.create(
      { ...d.attrs, finalSection: { columns: { count: 3, gap: 10, equalWidth: true } } },
      d.content,
    );
    const [final] = deriveSections(withAttrs);
    expect(final!.settings.columns).toEqual({ count: 3, gap: 10, equalWidth: true });
  });

  it("identifies a section by its terminating break's nodeId", () => {
    const d = doc(p("a"), sectionBreak(undefined, "brk-1"), p("b"));
    expect(deriveSections(d)[0]!.id).toBe("brk-1");
  });

  it("falls back to a deterministic ordinal id when a break has no nodeId", () => {
    const d = doc(p("a"), sectionBreak(), p("b"));
    expect(deriveSections(d)[0]!.id).toBe("section:0");
    expect(deriveSections(d)[0]!.id).toBe(deriveSections(d)[0]!.id);
  });

  it("keeps an empty final section when the last node is a break", () => {
    const d = doc(p("a"), sectionBreak());
    const sections = deriveSections(d);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.from).toBe(d.content.size);
    expect(sections[1]!.to).toBe(d.content.size);
  });

  it("returns one section per break plus the final one", () => {
    const d = doc(p("a"), sectionBreak(), p("b"), sectionBreak(), p("c"));
    expect(deriveSections(d)).toHaveLength(3);
  });

  it("always returns at least one section, even for an empty document", () => {
    expect(deriveSections(doc(p()))).toHaveLength(1);
  });
});

describe("sectionAt", () => {
  const d = doc(p("a"), sectionBreak(), p("b"));
  const sections = deriveSections(d);

  it("resolves a position inside the first section", () => {
    expect(sectionAt(sections, 1)).toBe(sections[0]);
  });

  it("resolves the terminating break to the section it terminates", () => {
    expect(sectionAt(sections, sections[0]!.breakPos!)).toBe(sections[0]);
  });

  it("resolves a position after the break to the final section", () => {
    expect(sectionAt(sections, sections[1]!.from + 1)).toBe(sections[1]);
  });

  it("clamps an out-of-range position to the nearest section", () => {
    expect(sectionAt(sections, -5)).toBe(sections[0]);
    expect(sectionAt(sections, 9999)).toBe(sections[1]);
  });
});
