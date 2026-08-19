import type { IBaseEditor, SemanticExportOptions, SemanticUnit } from "@scrivr/core";
import { collectHandlers } from "./collectHandlers";
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
  const ctx = createUnitCtx(editor, handlers.marks);
  const shortMax = options.shortBlockMaxChars ?? DEFAULT_SHORT_MAX;
  const group = options.groupBlocks ?? true;
  return walkSemantic(editor.getState().doc, ctx, handlers, shortMax, group);
}
