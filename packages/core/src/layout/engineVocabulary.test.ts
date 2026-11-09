/**
 * The engine lays out and paints blocks; what a list is belongs to `List`. A
 * name for one here means a list rule crept back into core.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Document-list vocabulary; "list" as plain English (an item list, a font list) is not one. */
const LIST_WORDS = /bullet|numbered|\blists\b|\b(a|the|nested|ordered) list\b|list[ -]?(item|marker|number|level|kind|start|indent|paragraph)|orderedList|bulletList/i;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });

describe("the engine's vocabulary", () => {
  it.each(["layout", "renderer"])("no source file under %s/ names a list", (dir) => {
    const named = sourceFiles(join(__dirname, "..", dir)).flatMap((file) =>
      readFileSync(file, "utf8").split("\n").flatMap((line, i) => (LIST_WORDS.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(named).toEqual([]);
  });
});
