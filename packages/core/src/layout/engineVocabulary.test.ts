/**
 * The engine lays out and paints blocks; what a node is belongs to its
 * extension. A name for one here means a node rule crept back into core.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Document-list vocabulary; "list" as plain English (an item list, a font list) is not one. */
const LIST_WORDS = /bullet|numbered|\blists\b|\b(a|the|nested|ordered) list\b|list[ -]?(item|marker|number|level|kind|start|indent|paragraph)|orderedList|bulletList/i;

/**
 * A font mark read by its name: compared, switched on, or looked up. "bold"
 * and "italic" alone are CSS words, and `fontFamily` is also a block attr.
 */
const FONT_MARKS = /(name ?[!=]==? ?|case |includes\(|marks\[)["'`](bold|italic|fontSize|fontFamily)["'`]/;

/** A table's node names, or the table-shaped layout vocabulary composites replaced. */
const TABLE_WORDS = /["'`](table|tableRow|tableCell|tableHeader)["'`]|\b(TableRow\w*|tableColumns|isLastRow|CellSubBlock|CellFloat|cellPos|CELL_PADDING\w*)\b/;

/** A node read by name as an image: compared, or looked up in the schema. */
const IMAGE_NODE = /name ?[!=]==? ?["'`]image["'`]|nodes\[["'`]image["'`]\]/;

/** Nodes and marks that declare what they do, through their spec, tokens, styles or font modifiers. */
const NODE_NAMES: Record<string, RegExp> = {
  layout: new RegExp(`${IMAGE_NODE.source}|\\b(pageBreak|hardBreak|sectionBreak)\\b|["'\`]heading(_\\d)?["'\`]|${FONT_MARKS.source}`),
  renderer: new RegExp(`${IMAGE_NODE.source}|\\b(pageBreak|hardBreak)\\b|${FONT_MARKS.source}`),
  fonts: FONT_MARKS,
  input: new RegExp(`${IMAGE_NODE.source}|["'\`](paragraph|heading|bulletList|orderedList|listItem)["'\`]`),
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });

const linesMatching = (dir: string, words: RegExp): string[] =>
  sourceFiles(join(__dirname, "..", dir)).flatMap((file) =>
    readFileSync(file, "utf8").split("\n").flatMap((line, i) => (words.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
  );

describe("the engine's vocabulary", () => {
  it.each(["layout", "renderer"])("no source file under %s/ names a list", (dir) => {
    expect(linesMatching(dir, LIST_WORDS)).toEqual([]);
  });

  it.each(Object.entries(NODE_NAMES))("no source file under %s/ names a node or mark that declares itself", (dir, words) => {
    expect(linesMatching(dir, words)).toEqual([]);
  });

  it.each(["layout", "renderer", "input"])("no source file under %s/ lays out or paints a table as a table", (dir) => {
    expect(linesMatching(dir, TABLE_WORDS)).toEqual([]);
  });

  it("the copy serializer runs what extensions declare, not a node's own rewrite", () => {
    const serializer = readFileSync(join(__dirname, "..", "input", "ClipboardSerializer.ts"), "utf8");
    expect(serializer.split("\n").filter((line) => /from ["'`]\.\.\/table\//.test(line))).toEqual([]);
  });

  it("the sections model finds a section boundary by its declaration, not its name", () => {
    const named = readFileSync(join(__dirname, "..", "model", "sections.ts"), "utf8").split("\n").filter((line) => /["'`]sectionBreak["'`]/.test(line));
    expect(named).toEqual([]);
  });

  it.each(["Editor.ts", "SelectionController.ts"])("%s finds a floating object by its declaration, not by name", (file) => {
    const named = readFileSync(join(__dirname, "..", file), "utf8").split("\n").filter((line) => IMAGE_NODE.test(line));
    expect(named).toEqual([]);
  });

  it("the editor reads a run's font through the font modifiers, not the marks' names", () => {
    const named = readFileSync(join(__dirname, "..", "Editor.ts"), "utf8").split("\n").filter((line) => FONT_MARKS.test(line));
    expect(named).toEqual([]);
  });
});
