/**
 * Factory for `DocxContext` + its internal build state.
 *
 * The public `DocxContext` only exposes producer APIs (`getOrCreate`, `warn`,
 * `add`) so handlers can't read or mutate package internals. The build state
 * is the backing store the OPC builder walks when assembling the ZIP parts.
 */

import type { IBaseEditor } from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";
import { xml, serializeXml } from "./xml";
import { walkDocument, type WalkerHandlers } from "./walker";
import type {
  DocxContext,
  DocxFidelity,
  DocxMediaPart,
  DocxNumberingLevel,
  DocxResolvedOptions,
  DocxStyleSpec,
  DocxUnsupportedPolicy,
  XmlNode,
} from "./context";
import type { DocxDiagnostic } from "./handlers";

/** Content types + relationship types for header/footer parts. */
const HEADER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const FOOTER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";

export interface CreateContextOptions {
  editor: IBaseEditor;
  /**
   * Merged node/mark handlers — `walkContent` reuses them for sub-documents.
   * Optional so unit tests can build a bare context; the real export pipeline
   * always supplies them (an empty set drops all content).
   */
  handlers?: WalkerHandlers;
  unsupported?: DocxUnsupportedPolicy;
  fidelity?: DocxFidelity;
}

export type DocxStyleType = "paragraph" | "character" | "table";

export interface StyleEntry {
  id: string;
  type: DocxStyleType;
  name: string;
  spec: DocxStyleSpec;
}

export interface NumberingEntry {
  numId: number;
  config: { type: "bullet" | "ordered" | "task"; levels: DocxNumberingLevel[] };
}

export interface RelEntry {
  id: string;
  type: "image" | "hyperlink" | "header" | "footer";
  target: string;
  /** "External" for hyperlinks; absent for internal (image/header/footer) refs. */
  mode?: "External";
}

/** An extra OPC part (a header/footer XML document) plus its content type. */
export interface ExtraPart {
  /** ZIP-relative path, e.g. `word/header1.xml`. */
  path: string;
  contentType: string;
  data: string;
  /**
   * Part-scoped relationships (images/hyperlinks referenced from this part).
   * Emitted as `word/_rels/{basename}.rels`; empty when the part has none.
   */
  rels: RelEntry[];
}

export interface DocxBuildState {
  styles: StyleEntry[];
  numbering: NumberingEntry[];
  rels: RelEntry[];
  media: DocxMediaPart[];
  parts: ExtraPart[];
  evenAndOddHeaders: boolean;
  diagnostics: DocxDiagnostic[];
}

export interface CreateContextResult {
  ctx: DocxContext;
  state: DocxBuildState;
}

export function createDocxContext(
  opts: CreateContextOptions,
): CreateContextResult {
  const options: DocxResolvedOptions = {
    unsupported: opts.unsupported ?? "drop",
    fidelity: opts.fidelity ?? "compatible",
  };

  const state: DocxBuildState = {
    styles: [],
    numbering: [],
    rels: [],
    media: [],
    parts: [],
    evenAndOddHeaders: false,
    diagnostics: [],
  };

  const sharedStore = new Map<string, unknown>();

  // OOXML relationships are part-scoped: a rel referenced from header1.xml must
  // live in word/_rels/header1.xml.rels, not the document's. `currentRels` is
  // the bucket `rels.addImage`/`addHyperlink` write to; it defaults to the
  // document bucket and is swapped to a part's own bucket while `parts.add`
  // walks that part's content.
  let currentRels: RelEntry[] = state.rels;

  const getOrCreateStyle = (
    type: DocxStyleType,
    name: string,
    spec: DocxStyleSpec,
  ): string => {
    const existing = state.styles.find(
      (s) => s.type === type && s.name === name,
    );
    if (existing) return existing.id;
    const id = uniqueStyleId(sanitizeStyleId(name), state.styles);
    state.styles.push({ id, type, name, spec });
    return id;
  };

  const ctx: DocxContext = {
    editor: opts.editor,
    options,
    styles: {
      paragraph: { getOrCreate: (n, s) => getOrCreateStyle("paragraph", n, s) },
      character: { getOrCreate: (n, s) => getOrCreateStyle("character", n, s) },
      table: { getOrCreate: (n, s) => getOrCreateStyle("table", n, s) },
    },
    numbering: {
      getOrCreate(config) {
        const key = numberingKey(config);
        const existing = state.numbering.find((entry) =>
          numberingKey(entry.config) === key
        );
        if (existing) return { numId: existing.numId };
        const numId = state.numbering.length + 1;
        state.numbering.push({ numId, config });
        return { numId };
      },
    },
    rels: {
      addImage(mediaFilename) {
        // Dedup within the current part: the same media file referenced twice
        // in one part reuses its relationship (media is a global pool).
        const target = `media/${mediaFilename}`;
        const existing = currentRels.find(
          (r) => r.type === "image" && r.target === target,
        );
        if (existing) return existing.id;
        const id = `rId${currentRels.length + 1}`;
        currentRels.push({ id, type: "image", target });
        return id;
      },
      addHyperlink(url) {
        const id = `rId${currentRels.length + 1}`;
        currentRels.push({ id, type: "hyperlink", target: url, mode: "External" });
        return id;
      },
    },
    media: {
      add({ data, contentType, ext }) {
        const filename = `image${state.media.length + 1}.${ext}`;
        state.media.push({ filename, contentType, data });
        return filename;
      },
      list() {
        return state.media.slice();
      },
    },
    diagnostics: {
      warn(d) {
        state.diagnostics.push({ level: "warning", ...d });
      },
      error(d) {
        state.diagnostics.push({ level: "error", ...d });
      },
      list() {
        return state.diagnostics.slice();
      },
    },
    document: xml("w:document"),
    walkContent(doc: PmNode): XmlNode[] {
      return walkDocument(doc, ctx, opts.handlers ?? { nodes: {}, marks: {} });
    },
    parts: {
      add({ kind, build }) {
        // The document-bucket rel that references this part from the sectPr.
        const relId = `rId${state.rels.length + 1}`;
        const index = state.parts.filter((p) => p.path.includes(`/${kind}`)).length + 1;
        const filename = `${kind}${index}.xml`;
        state.rels.push({ id: relId, type: kind, target: filename });

        // Walk the part's content with rels scoped to its own bucket, so any
        // images/hyperlinks it emits land in word/_rels/{filename}.rels.
        const partRels: RelEntry[] = [];
        const previous = currentRels;
        currentRels = partRels;
        let content: XmlNode;
        try {
          content = build();
        } finally {
          currentRels = previous;
        }

        state.parts.push({
          path: `word/${filename}`,
          contentType: kind === "header" ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE,
          data: serializeXml(content, { declaration: true }),
          rels: partRels,
        });
        return { relId };
      },
    },
    settings: {
      enableEvenAndOddHeaders() {
        state.evenAndOddHeaders = true;
      },
    },
    shared: {
      // Contained generic cast — the map stores `unknown` and the caller
      // owns the type via the generic parameter. Single use, inside impl,
      // not at call sites — same rule as a contained `as` inside a guard.
      getOrInit<T>(key: string, init: () => T): T {
        if (!sharedStore.has(key)) sharedStore.set(key, init());
        return sharedStore.get(key) as T;
      },
      get<T>(key: string): T | undefined {
        const v = sharedStore.get(key);
        return v === undefined ? undefined : (v as T);
      },
    },
  };

  return { ctx, state };
}

function sanitizeStyleId(name: string): string {
  // Word style IDs are case-sensitive, alphanumeric-only by convention.
  return name.replace(/[^A-Za-z0-9]/g, "") || "Style";
}

function uniqueStyleId(
  base: string,
  styles: StyleEntry[],
): string {
  const used = new Set(styles.map((s) => s.id));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

function numberingKey(config: NumberingEntry["config"]): string {
  return JSON.stringify({
    type: config.type,
    levels: config.levels.map((level) => ({
      level: level.level,
      format: level.format,
      text: level.text,
    })),
  });
}
