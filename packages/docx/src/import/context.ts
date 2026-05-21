/**
 * Import context — readers (the inverse of export's registry writers).
 *
 * Resolves cross-part references in the OPC package so handlers don't have
 * to know about ZIP layout: `relId → media bytes`, `styleId → name + spec`,
 * `numId → list shape`. MVP exposes the structural shape; loaders for the
 * styles/numbering/rels XMLs come online with the corresponding milestones.
 */

import type { DocxDiagnostic } from "@scrivr/core";
import type {
  DocxFidelity,
  DocxResolvedOptions,
  DocxUnsupportedPolicy,
} from "@scrivr/core";

export type DocxMediaSink = "data-url" | "object-url" | "drop";

export interface DocxImportOptions {
  unsupported?: DocxUnsupportedPolicy;
  fidelity?: DocxFidelity;
  /**
   * How to materialize image bytes:
   *   - `"data-url"` — base64 `data:` URL. Default. Simple, works everywhere.
   *   - `"object-url"` — `URL.createObjectURL(blob)`. Browser-only, caller
   *     manages lifecycle.
   *   - `"drop"` — emit no `src`; record a diagnostic. Useful when the
   *     caller wants to handle uploads itself.
   */
  media?: DocxMediaSink;
}

export interface DocxImportResolvedOptions extends DocxResolvedOptions {
  media: DocxMediaSink;
}

export interface DocxImportContext {
  readonly options: DocxImportResolvedOptions;
  diagnostics: {
    warn(d: Omit<DocxDiagnostic, "level">): void;
    error(d: Omit<DocxDiagnostic, "level">): void;
    list(): DocxDiagnostic[];
  };
  /** Cross-plugin storage (mirror of export-side `ctx.shared`). */
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
}

export function createDocxImportContext(
  opts: DocxImportOptions = {},
): DocxImportContext {
  const options: DocxImportResolvedOptions = {
    unsupported: opts.unsupported ?? "drop",
    fidelity: opts.fidelity ?? "compatible",
    media: opts.media ?? "data-url",
  };
  const diagnostics: DocxDiagnostic[] = [];
  const sharedStore = new Map<string, unknown>();
  return {
    options,
    diagnostics: {
      warn(d) { diagnostics.push({ level: "warning", ...d }); },
      error(d) { diagnostics.push({ level: "error", ...d }); },
      list() { return diagnostics.slice(); },
    },
    shared: {
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
}
