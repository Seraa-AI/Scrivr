import type { IBaseEditor, SemanticExportOptions, SemanticTextView, SemanticUnit } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { collectHandlers, type ResolvedHandlers } from "./collectHandlers";
import { createUnitCtx } from "./context";
import { walkSemantic } from "./walker";

const DEFAULT_SHORT_MAX = 200;

/**
 * Emit an ordered `SemanticUnit[]` from the editor's current document — the
 * `semantic` export lane. Structure + identity (nodeId) + heading breadcrumb,
 * ready for a downstream RAG pipeline to size and embed.
 *
 * Runs headless: works on any `BaseEditor` (Editor, ServerEditor) from
 * `contentJSON`, no Yjs or canvas required. Deterministic — same tree ⇒ same
 * units — so downstream change-detection can trust unit identity.
 *
 * @example
 * const units = toSemanticUnits(editor);
 * for (const u of units) embed(u.breadcrumb.join(" › ") + "\n" + u.text);
 */
export function toSemanticUnits(
  editor: IBaseEditor,
  options: SemanticExportOptions = {},
): SemanticUnit[] {
  const handlers = collectHandlers(editor, options.overrides);
  const view = options.view ?? "proposed";
  const doc = documentIn(editor.getState().doc, view, handlers);
  const ctx = createUnitCtx(editor, handlers, doc);
  const shortMax = options.shortBlockMaxChars ?? DEFAULT_SHORT_MAX;
  const group = options.groupBlocks ?? true;
  return walkSemantic(doc, ctx, handlers, shortMax, group, view);
}

/** The document `view` reads: the live one for the proposed view, or what a contribution supplies. */
function documentIn(live: PmNode, view: SemanticTextView, handlers: ResolvedHandlers): PmNode {
  if (view === "proposed") return live;
  for (const supply of handlers.documentsIn) {
    const doc = supply(live, view);
    if (doc) return doc;
  }
  return live;
}
