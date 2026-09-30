/**
 * The size in effect at the selection.
 *
 * `getActiveFontFamily` answers the family question — inline mark, then block
 * attr, then the document default — and a toolbar reads a value rather than a
 * mark. There was no counterpart for size, so a size control had to read the
 * `fontSize` mark itself and got `undefined` for every run that has none, which
 * is most of them: a run with no mark still renders at the block style's size.
 * The control then showed "unset" over text the document plainly draws at 12pt.
 */
import { describe, expect, it } from "vitest";
import { getBlockStyle, type BlockStyle, type FontConfig } from "../layout/FontConfig";
import { parseFontSizePx, resolveActiveFontSize } from "./activeFontSize";

const style = (font: string): BlockStyle => ({ font, spaceBefore: 0, spaceAfter: 0, align: "left" });

const CONFIG: FontConfig = {
  paragraph: style("14px Georgia"),
  heading_1: style("bold 32px Georgia"),
  heading_2: style("bold 24px Georgia"),
  codeBlock: style("13px monospace"),
};

describe("parseFontSizePx", () => {
  it("reads the size out of a block style's font shorthand", () => {
    expect(parseFontSizePx("14px Georgia")).toBe(14);
    expect(parseFontSizePx("bold 32px Georgia")).toBe(32);
    expect(parseFontSizePx("13.5px monospace")).toBe(13.5);
  });

  it("is null when the shorthand names no size", () => {
    expect(parseFontSizePx("bold Georgia")).toBeNull();
  });
});

describe("resolveActiveFontSize", () => {
  it("prefers the size an inline mark states", () => {
    expect(resolveActiveFontSize(18, getBlockStyle(CONFIG, "paragraph"))).toBe(18);
  });

  it("falls back to the block style, which is what the run actually renders at", () => {
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "paragraph"))).toBe(14);
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "codeBlock"))).toBe(13);
  });

  it("distinguishes heading levels, because the block style does", () => {
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "heading", 1))).toBe(32);
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "heading", 2))).toBe(24);
  });

  it("answers with a number even when the style names no size", () => {
    // A control needs a value to show; "unset" over text with a visible size is
    // the failure this exists to prevent.
    expect(resolveActiveFontSize(undefined, style("bold Georgia"))).toBeGreaterThan(0);
  });
});
