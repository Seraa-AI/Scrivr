import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ServerEditor, StarterKit, type Extension } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { importDocx, type DocxImportResult } from "../../import/import";

/**
 * The 25 Word documents the fidelity suite measures, and the import every
 * check starts from.
 *
 * They were chosen by provenance (`SOURCES.tsv`): saved by Word, created
 * before ChatGPT, edited over many sessions. The suite reads them as they are;
 * nothing here generates or rewrites a fixture.
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../wordTestFiles");

export interface WordFixture {
  /** The file name without `.docx`: `"01-administrative-f9355274cbfe"`. */
  name: string;
  bytes: Uint8Array;
}

export const FIXTURES: readonly WordFixture[] = readdirSync(FIXTURE_DIR)
  // Word's lock file for an open document (`~$…docx`) is not a fixture.
  .filter((file) => file.endsWith(".docx") && !file.startsWith("~$"))
  .sort()
  .map((file) => ({
    name: file.slice(0, -".docx".length),
    bytes: new Uint8Array(readFileSync(join(FIXTURE_DIR, file))),
  }));

/**
 * The built-in extensions an app that opens Word files would load. Tables are
 * opt-in in StarterKit, and Word documents are full of them: without the Table
 * extension a curriculum map imports as empty paragraphs.
 */
export function fidelityExtensions(): Extension[] {
  return [StarterKit.configure({ table: true })];
}

/** Import a fixture the way the tests read it: with unread tracking on. */
export function importFixture(fixture: WordFixture): Promise<DocxImportResult> {
  return importBytes(fixture.bytes, { trackUnread: true });
}

export function importBytes(bytes: Uint8Array, options: { trackUnread?: boolean } = {}): Promise<DocxImportResult> {
  return importDocx(new ServerEditor({ extensions: fidelityExtensions() }), bytes, options);
}

/** An editor holding `doc`, ready to be edited or exported. */
export function editorWith(doc: PmNode): ServerEditor {
  return new ServerEditor({ extensions: fidelityExtensions(), content: doc.toJSON() });
}
