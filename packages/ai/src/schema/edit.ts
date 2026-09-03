/**
 * The semantic edit protocol as zod schemas — the published, validated public
 * API of `@scrivr/ai`. Agent output is untrusted: any consumer (the playground
 * AI route, Seraa, third parties) calls `RichSemanticEditSchema.safeParse` (or
 * `parseRichEdits`) and gets typed, validated edits before anything reaches
 * `applyRichEdit`. `z.infer` is the source of truth for the types.
 *
 * Phase 1 ships `richText` (inline text/marks/attrs on a single leaf). Structural
 * ops (insert/delete/move block, list item, table row/column) are specced in the
 * RFC and join `SemanticEditSchema`'s discriminated union in later phases without
 * breaking consumers.
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

/**
 * The semantic edit protocol. Phase 1 is inline-only; the discriminated union
 * grows with the structural ops in later phases. Discriminate on `kind`.
 */
export const SemanticEditSchema = z.discriminatedUnion("kind", [RichSemanticEditSchema]);
export type SemanticEdit = z.infer<typeof SemanticEditSchema>;

/** One edit that failed validation, with its position and a readable reason. */
export interface RejectedEdit {
  /** Index in the input array, or -1 when the input itself was not an array. */
  index: number;
  error: string;
}

export interface ParsedRichEdits {
  edits: RichSemanticEdit[];
  rejected: RejectedEdit[];
}

/**
 * Validate untrusted agent output (an array of edits) into typed Phase-1
 * `RichSemanticEdit`s. Invalid entries are collected in `rejected` rather than
 * thrown, so one malformed edit never drops the whole batch. The returned
 * `edits` can be passed straight to `AiToolkitAPI.applyRichEdit`.
 */
export function parseRichEdits(input: unknown): ParsedRichEdits {
  const edits: RichSemanticEdit[] = [];
  const rejected: RejectedEdit[] = [];
  if (!Array.isArray(input)) {
    return { edits, rejected: [{ index: -1, error: "expected an array of edits" }] };
  }
  input.forEach((raw, index) => {
    const result = RichSemanticEditSchema.safeParse(raw);
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
