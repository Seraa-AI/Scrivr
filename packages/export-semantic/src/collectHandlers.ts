import type { Mark as PmMark, Node as PmNode } from "@scrivr/core/pm";
import type {
  ExportContributionMap,
  IBaseEditor,
  SemanticHandlers,
  SemanticNodeHandler,
  SemanticMarkHandler,
} from "@scrivr/core";

type NodeChanges = NonNullable<SemanticHandlers["nodeChanges"]>;

export interface ResolvedHandlers {
  nodes: Record<string, SemanticNodeHandler>;
  marks: Record<string, SemanticMarkHandler>;
  /** Every contributed `isRemoved`; a node any of them claims is left out. */
  removers: Array<(node: PmNode) => boolean>;
  /** Every contributed `nodeChanges`, read in contribution order. */
  nodeChangers: NodeChanges[];
  /** Every contributed `isMarkRemoved`; a mark any of them claims is left off the spans. */
  markRemovers: Array<(mark: PmMark) => boolean>;
  /** Every contributed `documentIn`; the first to answer for a view supplies its document. */
  documentsIn: DocumentIn[];
}

type DocumentIn = NonNullable<SemanticHandlers["documentIn"]>;

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
  if (value && typeof value === "object" &&
    ("nodes" in value || "marks" in value || ("isRemoved" in value && typeof value.isRemoved === "function") ||
      ("nodeChanges" in value && typeof value.nodeChanges === "function") ||
      ("isMarkRemoved" in value && typeof value.isMarkRemoved === "function") ||
      ("documentIn" in value && typeof value.documentIn === "function"))) {
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
  const removers: Array<(node: PmNode) => boolean> = [];
  const nodeChangers: NodeChanges[] = [];
  const markRemovers: Array<(mark: PmMark) => boolean> = [];
  const documentsIn: DocumentIn[] = [];

  for (const contrib of editor.getExportContributions()) {
    const semantic = semanticOf(contrib);
    if (!semantic) continue;
    if (semantic.nodes) Object.assign(nodes, semantic.nodes);
    if (semantic.marks) Object.assign(marks, semantic.marks);
    if (semantic.isRemoved) removers.push(semantic.isRemoved);
    if (semantic.nodeChanges) nodeChangers.push(semantic.nodeChanges);
    if (semantic.isMarkRemoved) markRemovers.push(semantic.isMarkRemoved);
    if (semantic.documentIn) documentsIn.push(semantic.documentIn);
  }

  if (overrides) {
    if (overrides.nodes) Object.assign(nodes, overrides.nodes);
    if (overrides.marks) Object.assign(marks, overrides.marks);
    if (overrides.isRemoved) removers.push(overrides.isRemoved);
    if (overrides.nodeChanges) nodeChangers.push(overrides.nodeChanges);
    if (overrides.isMarkRemoved) markRemovers.push(overrides.isMarkRemoved);
    if (overrides.documentIn) documentsIn.unshift(overrides.documentIn);
  }

  return { nodes, marks, removers, nodeChangers, markRemovers, documentsIn };
}
