/**
 * The exporter paints what layout and the extensions give it; how a list looks
 * belongs to `List`, and which blocks are bookmarked to theirs. A name for one
 * here means a node rule crept back in.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Document-list vocabulary; "list" as plain English (an item list, a font list) is not one. */
const LIST_WORDS = /bullet|numbered|\blists\b|\b(a|the|nested|ordered) list\b|list[ -]?(item|marker|number|level|kind|start|indent|paragraph)|orderedList|bulletList/i;

/** Nodes that declare their outline level through `pdf.outline`. */
const OUTLINE_NODES = /heading/i;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });

const linesMatching = (words: RegExp): string[] =>
  sourceFiles(join(__dirname, "..")).flatMap((file) =>
    readFileSync(file, "utf8").split("\n").flatMap((line, i) => (words.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
  );

describe("the exporter's vocabulary", () => {
  it("no source file names a list", () => {
    expect(linesMatching(LIST_WORDS)).toEqual([]);
  });

  it("no source file names a node that declares its outline level", () => {
    expect(linesMatching(OUTLINE_NODES)).toEqual([]);
  });
});
