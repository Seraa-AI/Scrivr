/**
 * Which blocks head a section is declared on their specs (`outlineLevel`);
 * which block is plain is the schema's default. The walker, the grouping and
 * the outline read those, so a name here means an outline rule crept back in.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** A node or unit read by name as a heading or a paragraph. */
const OUTLINE_NAMES = /(name|type) ?[!=]==? ?["'`](heading|paragraph)["'`]/;

describe("the semantic outline's vocabulary", () => {
  it.each(["walker.ts", "grouping.ts", "outline.ts"])("%s names no heading or paragraph", (file) => {
    const named = readFileSync(join(__dirname, "..", file), "utf8").split("\n").filter((line) => OUTLINE_NAMES.test(line));
    expect(named).toEqual([]);
  });
});
