/**
 * The engine lays out and paints blocks; what a node is belongs to its
 * extension. A name for one here means a node rule crept back into core.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Document-list vocabulary; "list" as plain English (an item list, a font list) is not one. */
const LIST_WORDS = /bullet|numbered|\blists\b|\b(a|the|nested|ordered) list\b|list[ -]?(item|marker|number|level|kind|start|indent|paragraph)|orderedList|bulletList/i;

/** Nodes that declare what they do, through their spec or their markdown tokens. */
const NODE_NAMES: Record<string, RegExp> = {
  layout: /\b(pageBreak|hardBreak)\b/,
  renderer: /\b(pageBreak|hardBreak)\b/,
  input: /["'`](heading|bulletList|orderedList|listItem)["'`]/,
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

  it.each(Object.entries(NODE_NAMES))("no source file under %s/ names a node that declares itself", (dir, words) => {
    expect(linesMatching(dir, words)).toEqual([]);
  });
});
