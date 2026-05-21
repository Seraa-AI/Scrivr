/**
 * Factory for `DocxContext` + its internal build state.
 *
 * The public `DocxContext` only exposes producer APIs (`getOrCreate`, `warn`,
 * `add`) so handlers can't read or mutate package internals. The build state
 * is the backing store the OPC builder walks when assembling the ZIP parts.
 */

import type { IBaseEditor } from "@scrivr/core";
import { xml } from "./xml";
import type {
  DocxContext,
  DocxFidelity,
  DocxMediaPart,
  DocxNumberingLevel,
  DocxResolvedOptions,
  DocxStyleSpec,
  DocxUnsupportedPolicy,
} from "./context";
import type { DocxDiagnostic } from "./handlers";

export interface CreateContextOptions {
  editor: IBaseEditor;
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
  type: "image" | "hyperlink";
  target: string;
  /** "External" for hyperlinks; absent for internal image refs. */
  mode?: "External";
}

export interface DocxBuildState {
  styles: StyleEntry[];
  numbering: NumberingEntry[];
  rels: RelEntry[];
  media: DocxMediaPart[];
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
    diagnostics: [],
  };

  const sharedStore = new Map<string, unknown>();

  const getOrCreateStyle = (
    type: DocxStyleType,
    name: string,
    spec: DocxStyleSpec,
  ): string => {
    const existing = state.styles.find(
      (s) => s.type === type && s.name === name,
    );
    if (existing) return existing.id;
    const id = sanitizeStyleId(name);
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
        const numId = state.numbering.length + 1;
        state.numbering.push({ numId, config });
        return { numId };
      },
    },
    rels: {
      addImage(mediaFilename) {
        const id = `rId${state.rels.length + 1}`;
        state.rels.push({ id, type: "image", target: `media/${mediaFilename}` });
        return id;
      },
      addHyperlink(url) {
        const id = `rId${state.rels.length + 1}`;
        state.rels.push({ id, type: "hyperlink", target: url, mode: "External" });
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

/** Read-only handle returned to callers — the diagnostics list, frozen. */
export function snapshotDiagnostics(state: DocxBuildState): DocxDiagnostic[] {
  return state.diagnostics.slice();
}
