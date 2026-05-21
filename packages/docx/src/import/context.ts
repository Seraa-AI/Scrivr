/**
 * Import context factory + re-exports.
 *
 * `DocxImportContext` lives in `@scrivr/core` so extensions can author
 * handlers against it. This file holds the runtime factory.
 */

import type { Schema } from "prosemirror-model";
import type {
  DocxDiagnostic,
  DocxImportContext,
  DocxImportResolvedOptions,
  DocxMediaSink,
  DocxFidelity,
  DocxUnsupportedPolicy,
} from "@scrivr/core";

export interface DocxImportOptions {
  unsupported?: DocxUnsupportedPolicy;
  fidelity?: DocxFidelity;
  /**
   * How to materialize image bytes:
   *   - `"data-url"` — base64 `data:` URL. Default. Works everywhere.
   *   - `"object-url"` — `URL.createObjectURL(blob)`. Browser-only.
   *   - `"drop"` — emit no `src`; record a diagnostic. Caller handles
   *     uploads.
   */
  media?: DocxMediaSink;
}

export interface CreateDocxImportContextInput extends DocxImportOptions {
  schema: Schema;
  /** Materialized-src lookup for image rels. Built by `buildImageResolver`. */
  resolveImage?: (relId: string) => string | undefined;
}

export function createDocxImportContext(
  input: CreateDocxImportContextInput,
): DocxImportContext {
  const options: DocxImportResolvedOptions = {
    unsupported: input.unsupported ?? "drop",
    fidelity: input.fidelity ?? "compatible",
    media: input.media ?? "data-url",
  };
  const diagnostics: DocxDiagnostic[] = [];
  const sharedStore = new Map<string, unknown>();
  const resolveImage = input.resolveImage ?? (() => undefined);
  return {
    options,
    schema: input.schema,
    diagnostics: {
      warn(d) { diagnostics.push({ level: "warning", ...d }); },
      error(d) { diagnostics.push({ level: "error", ...d }); },
      list() { return diagnostics.slice(); },
    },
    media: {
      resolveImage,
    },
    shared: {
      // Contained generic cast — Map stores unknown, caller owns the type.
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

export type {
  DocxImportContext,
  DocxImportResolvedOptions,
  DocxMediaSink,
} from "@scrivr/core";
