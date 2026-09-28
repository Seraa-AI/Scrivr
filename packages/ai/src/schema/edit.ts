/**
 * The semantic edit protocol as zod schemas — the published, validated public
 * API of `@scrivr/ai`. Agent output is untrusted: any consumer (the playground
 * AI route, Seraa, third parties) calls `SemanticEditSchema.safeParse` (or
 * `parseSemanticEdits`) and gets typed, validated edits before anything reaches
 * `applySemanticEdits`. `z.infer` is the source of truth for the types.
 *
 * `richText` carries inline text/marks/attrs on a single leaf; the structural ops
 * add and remove blocks, list items and table rows. Both address the document by
 * stable `nodeId` — the agent names a neighbour it was shown, never a position it
 * inferred. Move and table-column ops are specced in the RFC and rejected here
 * until they are built, so an unbuilt op fails loudly instead of reporting a
 * success that changed nothing.
 */
import { z } from "zod";

/** A formatting mark on an inline run — its type name and open attrs. */
export const InlineMarkSchema = z.strictObject({
  type: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
});
export type InlineMark = z.infer<typeof InlineMarkSchema>;

/** One inline run: text plus the formatting marks around it. */
export const InlineSpanSchema = z.strictObject({
  text: z.string(),
  marks: z.array(InlineMarkSchema),
});
export type InlineSpan = z.infer<typeof InlineSpanSchema>;

/**
 * Phase 1 edit: new inline content (`spans`) and/or block styling (`attrs`) on a
 * single leaf textblock, addressed by its stable `nodeId`. The agent never emits
 * document positions. `expectedContentHash` is the optional stale-edit guard
 * (the leaf's rich hash the agent saw); a mismatch skips the edit.
 */
export const RichSemanticEditSchema = z.strictObject({
  kind: z.literal("richText"),
  nodeId: z.string().min(1),
  spans: z.array(InlineSpanSchema).optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  expectedContentHash: z.string().optional(),
});
export type RichSemanticEdit = z.infer<typeof RichSemanticEditSchema>;

/** Where a new node goes, relative to the anchor the agent named. */
export const EditPositionSchema = z.enum(["before", "after"]);
export type EditPosition = z.infer<typeof EditPositionSchema>;

/**
 * A block the agent can ask for. Limited to the textblock types a semantic unit
 * is made of — a container (list, table) is built by its own ops, not dropped in
 * whole, because the agent would have to get its internal structure right.
 */
export const SemanticBlockInputSchema = z.strictObject({
  type: z.enum(["paragraph", "heading", "codeBlock"]),
  attrs: z.record(z.string(), z.unknown()).optional(),
  spans: z.array(InlineSpanSchema).optional(),
  level: z.number().int().min(1).max(6).optional(),
});
export type SemanticBlockInput = z.infer<typeof SemanticBlockInputSchema>;

/** One cell of an inserted table row. */
export const SemanticCellInputSchema = z.strictObject({
  attrs: z.record(z.string(), z.unknown()).optional(),
  spans: z.array(InlineSpanSchema).optional(),
});
export type SemanticCellInput = z.infer<typeof SemanticCellInputSchema>;

const structuralOp = <Op extends string, Shape extends z.ZodRawShape>(op: Op, shape: Shape) =>
  z.strictObject({ kind: z.literal("structural"), op: z.literal(op), ...shape });

/** Insert relative to a named neighbour — `strictObject` refuses `index`. */
const anchored = { position: EditPositionSchema, anchorNodeId: z.string().min(1) };

/**
 * Structural edits — the document's shape rather than a leaf's content. Each is
 * a semantic editor command, not a generic tree mutation: the agent says "a new
 * item after this one", and the engine resolves that to a position.
 *
 * Discriminated on `op` so a malformed edit is reported against the one op it
 * claimed to be, rather than against all six.
 */
export const StructuralSemanticEditSchema = z.discriminatedUnion("op", [
  structuralOp("insertBlock", { ...anchored, block: SemanticBlockInputSchema }),
  structuralOp("deleteBlock", { nodeId: z.string().min(1) }),
  structuralOp("insertListItem", {
    ...anchored,
    item: z.strictObject({
      spans: z.array(InlineSpanSchema),
      attrs: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  structuralOp("deleteListItem", { nodeId: z.string().min(1) }),
  structuralOp("insertTableRow", { ...anchored, cells: z.array(SemanticCellInputSchema).optional() }),
  structuralOp("deleteTableRow", { nodeId: z.string().min(1) }),
]);
export type StructuralSemanticEdit = z.infer<typeof StructuralSemanticEditSchema>;

/**
 * The semantic edit protocol — rich and structural, discriminated on `kind`.
 */
export const SemanticEditSchema = z.discriminatedUnion("kind", [
  RichSemanticEditSchema,
  StructuralSemanticEditSchema,
]);
export type SemanticEdit = z.infer<typeof SemanticEditSchema>;

/** One edit that failed validation, with its position and a readable reason. */
export interface RejectedEdit {
  /** Index in the input array, or -1 when the input itself was not an array. */
  index: number;
  error: string;
}

export interface ParsedSemanticEdits {
  edits: SemanticEdit[];
  rejected: RejectedEdit[];
}

/**
 * Validate untrusted agent output (an array of edits) into typed `SemanticEdit`s.
 * Invalid entries are collected in `rejected` rather than thrown, so one
 * malformed edit never drops the whole batch. The returned `edits` go straight
 * to `AiToolkitAPI.applySemanticEdits`.
 */
export function parseSemanticEdits(input: unknown): ParsedSemanticEdits {
  const edits: SemanticEdit[] = [];
  const rejected: RejectedEdit[] = [];
  if (!Array.isArray(input)) {
    return { edits, rejected: [{ index: -1, error: "expected an array of edits" }] };
  }
  input.forEach((raw, index) => {
    const result = SemanticEditSchema.safeParse(raw);
    if (result.success) {
      edits.push(result.data);
    } else {
      const reason = result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      rejected.push({ index, error: reason });
    }
  });
  return { edits, rejected };
}
