/**
 * DOCX export entry point.
 *
 * Pipeline:
 *   1. Collect handlers from extensions via `addExports().docx` (+ overrides).
 *   2. Create `DocxContext` + backing `DocxBuildState`.
 *   3. Run `onBeforeExport` hooks (precompute headings, footnotes, etc.).
 *   4. Walk the ProseMirror tree → body XML.
 *   5. Run `onBuildTreeComplete` hooks (bookmarks, cross-refs).
 *   6. Run `onFinalize` or default packager → `DocxPackage`.
 *   7. Serialize to ZIP → `Uint8Array`.
 *
 * Does NOT call `ensureLayout()` — DOCX is a semantic export. Reads
 * persistent doc attrs only; never CharacterMap, fragments, or tile state.
 *
 * Returns both `bytes` and `diagnostics` because DOCX export is inherently
 * lossy: unsupported nodes, marks without handlers, and approximations
 * during lossy mappings all surface as `level: "warning"` entries. Fatal
 * failures throw `DocxExportError` with the same diagnostics attached.
 */

import type { IBaseEditor } from "@scrivr/core";
import { walkDocument, type WalkerHandlers } from "./walker";
import { createDocxContext } from "./createContext";
import { buildDocxPackage } from "./defaults";
import { zipDocxPackage } from "./package";
import { DocxExportError } from "./error";
import type {
  DocxDiagnostic,
  DocxHandlers,
  DocxMarkHandler,
  DocxNodeHandler,
} from "./handlers";
import type {
  DocxFidelity,
  DocxUnsupportedPolicy,
} from "./context";

export interface DocxExportOptions {
  /** Override or supplement extension-contributed handlers. */
  overrides?: DocxHandlers;
  /** Behavior for unsupported nodes. Default: `"drop"`. */
  unsupported?: DocxUnsupportedPolicy;
  /** Fidelity dial. Default: `"compatible"`. */
  fidelity?: DocxFidelity;
}

export interface DocxExportResult {
  bytes: Uint8Array;
  diagnostics: DocxDiagnostic[];
}

/**
 * Export the editor's current document to DOCX format.
 *
 * Returns `{ bytes, diagnostics }` so callers can surface fidelity warnings
 * ("exported with 2 warnings: ..."). Throws `DocxExportError` on fatal
 * failures (e.g. `unsupported: "throw"` policy hits an unknown node).
 */
export async function exportDocx(
  editor: IBaseEditor,
  options: DocxExportOptions = {},
): Promise<DocxExportResult> {
  const handlers = collectHandlers(editor, options.overrides);

  const contextInit: Parameters<typeof createDocxContext>[0] = { editor };
  if (options.unsupported !== undefined) {
    contextInit.unsupported = options.unsupported;
  }
  if (options.fidelity !== undefined) {
    contextInit.fidelity = options.fidelity;
  }
  const { ctx, state } = createDocxContext(contextInit);

  const lifecycleHooks = collectLifecycleHooks(editor, options.overrides);

  try {
    for (const hook of lifecycleHooks.onBeforeExport) {
      await hook(ctx);
    }

    const walkerHandlers: WalkerHandlers = {
      nodes: handlers.nodes,
      marks: handlers.marks,
    };
    const body = walkDocument(editor.getState().doc, ctx, walkerHandlers);

    for (const hook of lifecycleHooks.onBuildTreeComplete) {
      await hook(ctx);
    }

    const pkg = lifecycleHooks.onFinalize
      ? await lifecycleHooks.onFinalize(ctx)
      : buildDocxPackage(body, state);

    return {
      bytes: zipDocxPackage(pkg),
      diagnostics: ctx.diagnostics.list(),
    };
  } catch (err) {
    if (err instanceof DocxExportError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new DocxExportError(message, ctx.diagnostics.list());
  }
}

/**
 * Ergonomic helper — returns just the bytes. Diagnostics are dropped, so
 * use this only when you don't need to surface fidelity warnings.
 */
export async function exportDocxBytes(
  editor: IBaseEditor,
  options?: DocxExportOptions,
): Promise<Uint8Array> {
  const result = await exportDocx(editor, options);
  return result.bytes;
}

interface ResolvedHandlers {
  nodes: Record<string, DocxNodeHandler>;
  marks: Record<string, DocxMarkHandler>;
}

interface LifecycleHooks {
  onBeforeExport: Array<NonNullable<DocxHandlers["onBeforeExport"]>>;
  onBuildTreeComplete: Array<NonNullable<DocxHandlers["onBuildTreeComplete"]>>;
  /** Last-writer-wins — overrides.onFinalize beats extension contributions. */
  onFinalize?: NonNullable<DocxHandlers["onFinalize"]>;
}

function collectHandlers(
  editor: IBaseEditor,
  overrides?: DocxHandlers,
): ResolvedHandlers {
  // Each node + mark contributes its DOCX export via the owning extension's
  // `addExports().docx`. Overrides win per-call. There's no defaults layer
  // in this package — see Bold.ts, Image.ts, Heading.ts, etc.
  const nodes: Record<string, DocxNodeHandler> = {};
  const marks: Record<string, DocxMarkHandler> = {};

  for (const contrib of editor.getExportContributions()) {
    const docx = contrib.docx;
    if (!docx) continue;
    if (docx.nodes) Object.assign(nodes, docx.nodes);
    if (docx.marks) Object.assign(marks, docx.marks);
  }

  if (overrides) {
    if (overrides.nodes) Object.assign(nodes, overrides.nodes);
    if (overrides.marks) Object.assign(marks, overrides.marks);
  }

  return { nodes, marks };
}

function collectLifecycleHooks(
  editor: IBaseEditor,
  overrides?: DocxHandlers,
): LifecycleHooks {
  const hooks: LifecycleHooks = {
    onBeforeExport: [],
    onBuildTreeComplete: [],
  };

  for (const contrib of editor.getExportContributions()) {
    const docx = contrib.docx;
    if (!docx) continue;
    if (docx.onBeforeExport) hooks.onBeforeExport.push(docx.onBeforeExport);
    if (docx.onBuildTreeComplete)
      hooks.onBuildTreeComplete.push(docx.onBuildTreeComplete);
    if (docx.onFinalize) hooks.onFinalize = docx.onFinalize;
  }

  if (overrides) {
    if (overrides.onBeforeExport) hooks.onBeforeExport.push(overrides.onBeforeExport);
    if (overrides.onBuildTreeComplete)
      hooks.onBuildTreeComplete.push(overrides.onBuildTreeComplete);
    if (overrides.onFinalize) hooks.onFinalize = overrides.onFinalize;
  }

  return hooks;
}
