import type {
  ExportContributionMap,
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
 * Read the `semantic` contribution structurally, WITHOUT depending on the
 * `FormatHandlers` "semantic" augmentation being loaded. This is what lets
 * `@scrivr/export-semantic` be imported for its runtime (e.g. by
 * `@scrivr/plugins`' AiToolkit) without dragging the `semantic` key into the
 * consumer's `addExports()` type space — which would make their FormatHandlers
 * map non-empty and break OTHER extensions' returns via the empty-map leniency.
 * Extensions that WRITE semantic handlers opt into the key with
 * `import "@scrivr/export-semantic/augment"`.
 */
function semanticOf(contrib: ExportContributionMap): SemanticHandlers | undefined {
  const record: Record<string, unknown> = contrib;
  const value = record["semantic"];
  if (value && typeof value === "object" && ("nodes" in value || "marks" in value)) {
    return value as SemanticHandlers; // single guarded cast after typeof/in checks
  }
  return undefined;
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
    const semantic = semanticOf(contrib);
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
