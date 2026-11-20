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
 * Returns `bytes`, `diagnostics` and `report` because DOCX export is
 * inherently lossy: unsupported nodes, marks without handlers, and
 * approximations during lossy mappings all surface as `level: "warning"`
 * entries, and the report counts what was kept and dropped. Fatal failures
 * throw `DocxExportError` with the same diagnostics attached.
 */

import type { DocxReport, IBaseEditor } from "@scrivr/core";
import { walkDocument, type WalkerHandlers } from "./walker";
import { createDocxContext } from "./createContext";
import { buildDocxPackage, buildDocumentRoot } from "./defaults";
import { zipDocxPackage } from "./package";
import { DocxExportError } from "./error";
import type {
  DocxDiagnostic,
  DocxHandlers,
  DocxMarkHandler,
  DocxNodeHandler,
  DocxRunWrapper,
} from "./handlers";
import type {
  DocxFidelity,
  DocxUnsupportedPolicy,
} from "./context";
import {
  assignOwned,
  ownedBundles,
  reportRecorderOf,
  type HandlerOwner,
  type OwnedHook,
} from "../report";

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
  /** What the export wrote and what it could not — see `DocxReporter`. */
  report: DocxReport;
}

/**
 * Export the editor's current document to DOCX format.
 *
 * Returns `{ bytes, diagnostics, report }` so callers can surface fidelity
 * warnings ("exported with 2 warnings: ...") and say what was carried
 * across. Throws `DocxExportError` on fatal failures (e.g. the
 * `unsupported: "throw"` policy hits an unknown node).
 */
export async function exportDocx(
  editor: IBaseEditor,
  options: DocxExportOptions = {},
): Promise<DocxExportResult> {
  const handlers = collectHandlers(editor, options.overrides);
  const walkerHandlers: WalkerHandlers = {
    nodes: handlers.nodes,
    marks: handlers.marks,
    markWrappers: handlers.markWrappers,
    owners: handlers.owners,
  };

  // Hand the merged handlers to the context so `ctx.walkContent` renders
  // sub-documents (headers/footers) through the exact same node/mark handlers
  // as the body.
  const contextInit: Parameters<typeof createDocxContext>[0] = {
    editor,
    handlers: walkerHandlers,
  };
  if (options.unsupported !== undefined) {
    contextInit.unsupported = options.unsupported;
  }
  if (options.fidelity !== undefined) {
    contextInit.fidelity = options.fidelity;
  }
  const { ctx, state } = createDocxContext(contextInit);
  const recorder = reportRecorderOf(ctx);

  const lifecycleHooks = collectLifecycleHooks(editor, options.overrides);

  try {
    for (const { owner, hook } of lifecycleHooks.onBeforeExport) {
      await recorder.attributeAsync(owner, () => hook(ctx));
    }

    const body = walkDocument(editor.getState().doc, ctx, walkerHandlers);

    // Publish the assembled document tree so onBuildTreeComplete + onFinalize
    // hooks can read or mutate it (bookmarks, cross-refs, custom packagers).
    ctx.document = buildDocumentRoot(body);

    for (const { owner, hook } of lifecycleHooks.onBuildTreeComplete) {
      await recorder.attributeAsync(owner, () => hook(ctx));
    }

    const finalize = lifecycleHooks.onFinalize;
    const pkg = finalize
      ? await recorder.attributeAsync(finalize.owner, () => finalize.hook(ctx))
      : buildDocxPackage(ctx.document, state);

    return {
      bytes: zipDocxPackage(pkg),
      diagnostics: ctx.diagnostics.list(),
      report: recorder.snapshot(),
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
  markWrappers: Record<string, DocxRunWrapper>;
  owners: {
    nodes: Record<string, HandlerOwner>;
    marks: Record<string, HandlerOwner>;
    markWrappers: Record<string, HandlerOwner>;
  };
}

interface LifecycleHooks {
  onBeforeExport: Array<OwnedHook<NonNullable<DocxHandlers["onBeforeExport"]>>>;
  onBuildTreeComplete: Array<OwnedHook<NonNullable<DocxHandlers["onBuildTreeComplete"]>>>;
  /** Last-writer-wins — overrides.onFinalize beats extension contributions. */
  onFinalize?: OwnedHook<NonNullable<DocxHandlers["onFinalize"]>>;
}

function docxExportBundles(
  editor: IBaseEditor,
  overrides: DocxHandlers | undefined,
): Array<{ owner: HandlerOwner; bundle: DocxHandlers }> {
  return ownedBundles(editor.getFormatContributions(), (c) => c.exports.docx, overrides);
}

function collectHandlers(
  editor: IBaseEditor,
  overrides?: DocxHandlers,
): ResolvedHandlers {
  // Each node + mark contributes its DOCX export via the owning extension's
  // `addExports().docx`. Overrides win per-call. There's no defaults layer
  // in this package — see Bold.ts, Image.ts, Heading.ts, etc.
  const resolved: ResolvedHandlers = {
    nodes: {},
    marks: {},
    markWrappers: {},
    owners: { nodes: {}, marks: {}, markWrappers: {} },
  };

  for (const { owner, bundle: docx } of docxExportBundles(editor, overrides)) {
    assignOwned(resolved.nodes, resolved.owners.nodes, docx.nodes, owner);
    assignOwned(resolved.marks, resolved.owners.marks, docx.marks, owner);
    assignOwned(resolved.markWrappers, resolved.owners.markWrappers, docx.markWrappers, owner);
  }

  return resolved;
}

function collectLifecycleHooks(
  editor: IBaseEditor,
  overrides?: DocxHandlers,
): LifecycleHooks {
  const hooks: LifecycleHooks = {
    onBeforeExport: [],
    onBuildTreeComplete: [],
  };

  for (const { owner, bundle: docx } of docxExportBundles(editor, overrides)) {
    if (docx.onBeforeExport) hooks.onBeforeExport.push({ owner, hook: docx.onBeforeExport });
    if (docx.onBuildTreeComplete) {
      hooks.onBuildTreeComplete.push({ owner, hook: docx.onBuildTreeComplete });
    }
    if (docx.onFinalize) hooks.onFinalize = { owner, hook: docx.onFinalize };
  }

  return hooks;
}
