import type {
  IBaseEditor,
  SemanticHandlers,
  SemanticNodeHandler,
  SemanticMarkHandler,
} from "@scrivr/core";

export interface ResolvedHandlers {
  nodes: Record<string, SemanticNodeHandler>;
  marks: Record<string, SemanticMarkHandler>;
}

/**
 * Merge every extension's `addExports().semantic` contribution, keyed by node /
 * mark name. Overrides win per-call. Mirrors the DOCX `collectHandlers` — the
 * seam is the spine, so built-in and custom nodes are collected identically.
 */
export function collectHandlers(
  editor: IBaseEditor,
  overrides?: SemanticHandlers,
): ResolvedHandlers {
  const nodes: Record<string, SemanticNodeHandler> = {};
  const marks: Record<string, SemanticMarkHandler> = {};

  for (const contrib of editor.getExportContributions()) {
    const semantic = contrib.semantic;
    if (!semantic) continue;
    if (semantic.nodes) Object.assign(nodes, semantic.nodes);
    if (semantic.marks) Object.assign(marks, semantic.marks);
  }

  if (overrides) {
    if (overrides.nodes) Object.assign(nodes, overrides.nodes);
    if (overrides.marks) Object.assign(marks, overrides.marks);
  }

  return { nodes, marks };
}
