import { Extension, IMAGE_NODE_ATTRS, stableStringify } from "@scrivr/core";
import type { IBaseEditor, IEditor, SemanticChange, SemanticImage, SemanticPart, SemanticUnit } from "@scrivr/core";
import type { ReviewDecisions, ReviewOutcome } from "@scrivr/plugins";
import { semanticPartRichHash, toSemanticUnits, unitRichHash } from "@scrivr/export-semantic";
import { SemanticImageAttrsSchema, type SemanticEdit, type StructuralSemanticEdit } from "../schema/edit";
import { applyStructuralEdits } from "./applyStructuralEdits";
import { applyImageLayout, type ImageLayoutEdit } from "./imageAttrs";
import { toCoreSpans } from "./spans";
import { UniqueId } from "./UniqueId";
import { GhostText, ghostTextPluginKey } from "./GhostText";
import { AiCaret, aiCaretPluginKey } from "./AiCaret";
import { findLiveNodeById, isShadowNode, moveShadowRanges, reviewChanges, trackAsSuggestion } from "@scrivr/plugins";
import { aiToolkitRegistry } from "./aiToolkitRegistry";
import { applyRichDiffAsSuggestion, buildAcceptedTextMap, type RichBlockEdit } from "@scrivr/plugins";

export { unitRichHash };
import type { Node as PmNode, Schema } from "@scrivr/core/pm";
import type { Command } from "@scrivr/core/pm";
import { AiSuggestion as AiSuggestionExtension } from "../ai-suggestion/AiSuggestion";
import { computeAiSuggestion } from "../ai-suggestion/computeAiSuggestion";
import { showAiSuggestion, applyAiSuggestion, rejectAiSuggestion } from "../ai-suggestion/showHideApply";
import { aiSuggestionPluginKey } from "../ai-suggestion/AiSuggestionPlugin";
import type { AiSuggestion as AiSuggestionData, ApplyAiSuggestionOptions, RejectAiSuggestionOptions } from "../ai-suggestion/types";
import type { ComputeAiSuggestionOptions } from "../ai-suggestion/computeAiSuggestion";

/**
 * Namespaced API for AI suggestion overlay — accessed via `ai.suggestions`.
 *
 * All methods are thin wrappers around the standalone functions in
 * showHideApply.ts, bound to the editor instance so callers don't need to
 * manage state/dispatch themselves.
 */
export class AiSuggestionsAPI {
  constructor(private readonly editor: IBaseEditor) {}

  /**
   * Compute a word-level diff between the current document and proposed text.
   * Pure — no document mutation.
   *
   * @returns Serializable AiSuggestion JSON, or null if no changes detected.
   *
   * @example
   * const s = ai.suggestions.compute({
   *   blocks: [{ nodeId, proposedText: "..." }],
   *   authorID: "AI Assistant",
   * });
   * if (s) await db.save(s);
   */
  compute(options: ComputeAiSuggestionOptions): AiSuggestionData | null {
    return computeAiSuggestion(this.editor.getState(), options);
  }

  /**
   * Display a suggestion as a canvas overlay. The document is NOT modified.
   * Pass a previously saved AiSuggestion JSON to restore across sessions.
   */
  show(suggestion: AiSuggestionData): void {
    showAiSuggestion(this.editor, suggestion);
  }

  /** Hide the current suggestion overlay without modifying the document. */
  hide(): void {
    showAiSuggestion(this.editor, null);
  }

  /**
   * Apply the current suggestion (or a specific group/block) to the document.
   *
   * @param options.mode     "direct" — plain replace. "tracked" — adds track-changes marks.
   * @param options.groupId  Apply only this group; others remain in the overlay.
   * @param options.blockId  Apply only this block; others remain in the overlay.
   * @param options.range    Apply only within this span of the block's accepted
   *                         text. Refused if the span is stale — hence the
   *                         return value.
   * @returns whether the document changed.
   */
  apply(options: ApplyAiSuggestionOptions): boolean {
    return applyAiSuggestion(this.editor, options);
  }

  /**
   * Reject (discard) the current suggestion or a specific group/block.
   * No document changes — the overlay is simply hidden or trimmed.
   * Changes already applied in tracked mode are reviewed separately through
   * `reviewChanges`, using their tracked-change IDs.
   */
  reject(options?: RejectAiSuggestionOptions): void {
    rejectAiSuggestion(this.editor, options);
  }

  /** Returns the currently displayed suggestion, or null. */
  getCurrent(): AiSuggestionData | null {
    return aiSuggestionPluginKey.getState(this.editor.getState())?.suggestion ?? null;
  }
}

/**
 * The units an agent reads: one per block. A pending move leaves a copy of the
 * moved block where it was, under the same ids; that copy — inside a move's
 * left-behind range — is left out with its parts. Any other unit stays, a
 * block proposed for deletion included, whatever id it carries.
 *
 * Read with `groupBlocks: false`, unit i is the document's top-level block i,
 * and a unit's parts are its block's id-carrying textblocks in order; a copy is
 * judged by where that block is.
 */
function unitsToRead(units: SemanticUnit[], doc: PmNode): SemanticUnit[] {
  const moved = moveShadowRanges(doc);
  if (moved.length === 0) return units;
  const blocks: Array<{ node: PmNode; pos: number }> = [];
  doc.forEach((node, pos) => blocks.push({ node, pos }));
  return units.flatMap((unit, i) => {
    const block = blocks[i];
    if (!block || block.node.attrs["nodeId"] !== unit.id) return [unit];
    if (isShadowNode(block.node, block.pos, moved)) return [];
    if (!unit.parts) return [unit];
    const leaves: Array<{ node: PmNode; pos: number }> = [];
    block.node.descendants((node, offset) => {
      if (node.isTextblock && typeof node.attrs["nodeId"] === "string") leaves.push({ node, pos: block.pos + 1 + offset });
      return !node.isTextblock;
    });
    const aligned = leaves.length === unit.parts.length && leaves.every((leaf, j) => leaf.node.attrs["nodeId"] === unit.parts?.[j]?.nodeId);
    if (!aligned) return [unit];
    return [{ ...unit, parts: unit.parts.filter((_part, j) => {
      const leaf = leaves[j];
      return !leaf || !isShadowNode(leaf.node, leaf.pos, moved);
    }) }];
  });
}

/** The image fields `proposed` sets to something other than what `current` has. */
function changedImageFields(current: SemanticImage | undefined, proposed: unknown): Record<string, unknown> {
  if (typeof proposed !== "object" || proposed === null) return {};
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(proposed)) {
    if (key in IMAGE_NODE_ATTRS && value !== Reflect.get(current ?? {}, key)) changed[key] = value;
  }
  return changed;
}

/** Distinguish a whole `SemanticUnit` (has `nodeIds[]`) from a `RichBlockEdit` (has `nodeId`). */
function isSemanticUnit(item: RichBlockEdit | SemanticUnit): item is SemanticUnit {
  return "nodeIds" in item && Array.isArray(item.nodeIds);
}

/** The blocks one id names as read: those still there, and those proposed for deletion. */
interface Named<T> {
  live: T[];
  deleted: T[];
}

function blocksById<T extends { proposedForDeletion?: true }>(items: readonly T[], idOf: (item: T) => string): Map<string, Named<T>> {
  const out = new Map<string, Named<T>>();
  for (const item of items) {
    const named = out.get(idOf(item)) ?? { live: [], deleted: [] };
    (item.proposedForDeletion ? named.deleted : named.live).push(item);
    out.set(idOf(item), named);
  }
  return out;
}

/** The blocks a handed-back unit can mean: those read as it was — live or proposed for deletion — else any. */
function meant<T>(named: Named<T> | undefined, deleted: boolean): T[] {
  if (!named) return [];
  const same = deleted ? named.deleted : named.live;
  return same.length > 0 ? same : [...named.live, ...named.deleted];
}

interface ChangeHolder {
  changes?: SemanticChange[];
}

/**
 * `item` with `current`'s review changes in place of its own. An agent cannot
 * edit `changes`, so whatever it hands back there must not read as an edit.
 */
function withCurrentChanges<T extends ChangeHolder>(item: T, current: ChangeHolder | undefined): T {
  const copy = { ...item };
  delete copy.changes;
  if (current?.changes) copy.changes = current.changes;
  return copy;
}

/** `withCurrentChanges` on a unit and on each of its parts and cells, all of which its hash covers. */
function unitWithCurrentChanges(unit: SemanticUnit, current: SemanticUnit): SemanticUnit {
  const copy = withCurrentChanges(unit, current);
  if (unit.parts) {
    copy.parts = unit.parts.map((part) => withCurrentChanges(part, current.parts?.find((p) => p.nodeId === part.nodeId)));
  }
  if (unit.cells) {
    copy.cells = {
      rows: unit.cells.rows.map((row, r) => ({
        cells: row.cells.map((cell, c) => withCurrentChanges(cell, current.cells?.rows[r]?.cells[c])),
      })),
    };
  }
  return copy;
}

/** A caller-pinned source hash on a unit (optional stale-edit guard). */
function sourceHashOf(item: SemanticUnit): string | undefined {
  return readStringField(item, "expectedContentHash") ?? readStringField(item, "richHash");
}

function editForPart(part: SemanticPart): RichBlockEdit {
  return {
    nodeId: part.nodeId,
    spans: part.spans ?? [{ text: part.text, marks: [] }],
    ...(part.attrs ? { attrs: part.attrs } : {}),
  };
}

function readStringField(item: unknown, key: string): string | undefined {
  if (!item || typeof item !== "object" || !(key in item)) return undefined;
  const value = (item as Record<string, unknown>)[key]; // guarded cast after typeof + in
  return typeof value === "string" ? value : undefined;
}

/**
 * AiToolkitAPI — the single entry point for all AI interactions with an editor.
 *
 * Obtain via:
 *   import { getAiToolkit } from "@scrivr/plugins";
 *   const ai = getAiToolkit(editor);
 *
 * Never instantiate directly — created by AiToolkit.onEditorReady().
 */
export class AiToolkitAPI {
  /**
   * AI suggestion overlay API.
   * null if the AiSuggestion extension was not included (aiSuggestion: false).
   */
  readonly suggestions: AiSuggestionsAPI | null;

  constructor(private readonly editor: IBaseEditor, hasSuggestion: boolean) {
    this.suggestions = hasSuggestion ? new AiSuggestionsAPI(editor) : null;
  }

  // ── Read API ───────────────────────────────────────────────────────────────

  /**
   * Returns plain text for a document position range.
   * Block boundaries are joined with a newline.
   */
  getTextRange(from: number, to: number): string {
    const doc = this.editor.getState().doc;
    return doc.textBetween(
      Math.max(0, from),
      Math.min(doc.content.size, to),
      "\n",
    );
  }

  /**
   * Returns Markdown for a document position range.
   * Serializes the whole document, then extracts the section corresponding
   * to the plain-text content of the range. Falls back to plain text if the
   * markdown extraction heuristic fails.
   */
  getMarkdownRange(from: number, to: number): string {
    const doc  = this.editor.getState().doc;
    const size = doc.content.size;
    const f    = Math.max(0, from);
    const t    = Math.min(size, to);

    const rangeText = doc.textBetween(f, t, "\n");
    if (!rangeText) return "";

    const full = this.editor.getMarkdown();

    // Find the range text inside the serialized markdown
    const idx = full.indexOf(rangeText);
    if (idx >= 0) return full.slice(idx, idx + rangeText.length);

    // Fallback: plain text
    return rangeText;
  }

  /**
   * Returns text context around the current cursor — before, selection, after.
   * Useful for constructing AI prompts that need document context.
   */
  getContext(options?: {
    beforeChars?:      number;
    afterChars?:       number;
    includeSelection?: boolean;
  }): {
    before:      string;
    after:       string;
    selection:   string;
    cursorPos:   number;
    totalLength: number;
  } {
    const {
      beforeChars      = 2000,
      afterChars       = 500,
      includeSelection = true,
    } = options ?? {};

    const doc     = this.editor.getState().doc;
    const { from, to } = this.editor.getState().selection;
    const docSize = doc.content.size;

    return {
      before:      doc.textBetween(Math.max(0, from - beforeChars), from, "\n"),
      after:       doc.textBetween(to, Math.min(docSize, to + afterChars), "\n"),
      selection:   includeSelection ? doc.textBetween(from, to, "\n") : "",
      cursorPos:   from,
      totalLength: docSize,
    };
  }

  /**
   * Splits the full Markdown document into chunks of at most `chunkSize` chars.
   * Use this to feed large documents to AI models with limited context windows.
   */
  getTextChunks(chunkSize: number): string[] {
    const full    = this.editor.getMarkdown();
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += chunkSize) {
      chunks.push(full.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Returns a human-readable description of the active document schema.
   * Include this in AI system prompts so the model knows what content is valid.
   *
   * @example
   * const { nodes, marks } = ai.getSchemaDescription();
   * // nodes: [{ name: "paragraph", isBlock: true, attrs: ["align"] }, ...]
   */
  getSchemaDescription(): {
    nodes: Array<{ name: string; isBlock: boolean; attrs: string[] }>;
    marks: Array<{ name: string; attrs: string[] }>;
  } {
    const schema = this.editor.getState().schema as Schema;

    const nodes = Object.entries(schema.nodes)
      .filter(([name]) => name !== "doc" && name !== "text")
      .map(([name, type]) => ({
        name,
        isBlock: type.isBlock,
        // Strip internal attrs that AI shouldn't know about
        attrs: Object.keys(type.spec.attrs ?? {}).filter(
          (a) => a !== "nodeId" && a !== "dataTracked",
        ),
      }));

    const marks = Object.entries(schema.marks).map(([name, type]) => ({
      name,
      attrs: Object.keys(type.spec.attrs ?? {}),
    }));

    return { nodes, marks };
  }

  /**
   * Returns the accepted text of every top-level block in the document,
   * each paired with its stable nodeId.
   *
   * "Accepted text" means pending deletions are excluded and pending insertions
   * are included — exactly what a human reader sees. This is what you should
   * send to the LLM as document context.
   *
   * Pass `from` / `to` to restrict to blocks that overlap a doc position range
   * (e.g. the current selection). Omit both to get all blocks.
   *
   * Blocks without a nodeId (e.g. imported docs that predate UniqueId) are
   * silently skipped — they cannot be targeted by applyMultiBlockDiff anyway.
   *
   * @example
   * // Full document
   * const blocks = ai.getBlocks();
   *
   * // Current selection only
   * const { from, to } = editor.getState().selection;
   * const blocks = ai.getBlocks(from, to);
   */
  getBlocks(from?: number, to?: number): Array<{ nodeId: string; text: string }> {
    const state  = this.editor.getState();
    const schema = state.schema as Schema;
    const blocks: Array<{ nodeId: string; text: string }> = [];

    state.doc.forEach((node, offset) => {
      const nodeStart = offset;
      const nodeEnd   = offset + node.nodeSize;

      // If a range was given, skip blocks that don't overlap it.
      if (from !== undefined && to !== undefined) {
        if (nodeEnd <= from || nodeStart >= to) return;
      }

      const nodeId = node.attrs["nodeId"] as string | null | undefined;
      if (!nodeId) return;

      const { acceptedText } = buildAcceptedTextMap(node, offset, schema);
      if (acceptedText) blocks.push({ nodeId, text: acceptedText });
    });

    return blocks;
  }

  // ── Rich (formatting-aware) API ──────────────────────────────────────────────

  /**
   * Like `getBlocks`, but each block is a full `SemanticUnit` carrying its
   * inline formatting (`spans`) and block styling (`attrs`) — the rich context
   * an agent needs to see and preserve formatting. Emits ONE unit per top-level
   * block (grouping bypassed) so the edit round-trips mechanically; container
   * units still expose their inner leaves via `parts`.
   *
   * With TrackChanges, `text` is the proposed version and each unit, part and
   * cell lists its pending `changes`, each with the id `reviewChanges` takes.
   * A block proposed for deletion is included, reading `text: ""` with its
   * deletion; the copy a pending move leaves behind is not.
   *
   * Pass `from` / `to` to restrict to blocks overlapping a position range.
   *
   * @example
   * const units = ai.getRichBlocks();
   * const edited = await llm.rewrite(units); // returns edited units
   * ai.applyRichEdit(edited);
   */
  getRichBlocks(from?: number, to?: number): SemanticUnit[] {
    const units = unitsToRead(toSemanticUnits(this.editor, { groupBlocks: false }), this.editor.getState().doc);
    if (from === undefined || to === undefined) return units;
    const allowed = new Set<string>();
    this.editor.getState().doc.forEach((node, offset) => {
      const nodeId = node.attrs["nodeId"];
      if (typeof nodeId === "string" && offset < to && offset + node.nodeSize > from) allowed.add(nodeId);
    });
    return units.filter((u) => allowed.has(u.id));
  }

  /**
   * Accept or reject pending changes by the ids `getRichBlocks` reports. The
   * id decides the whole act — both halves of a replacement or a move, a block
   * and its text. Whether an agent may review at all is the host's call
   * (`TrackChanges.configure({ canAcceptReject })`); a refusal says why.
   *
   * @example
   * const change = ai.getRichBlocks()[0]?.changes?.[0];
   * if (change?.id) ai.reviewChanges({ accepted: [change.id], rejected: [] });
   */
  reviewChanges(decisions: ReviewDecisions): ReviewOutcome {
    return reviewChanges(this.editor, decisions);
  }

  /**
   * Apply the agent's rich edits as tracked-change suggestions, preserving
   * untouched formatting.
   *
   * Accepts either explicit `RichBlockEdit`s (`{ nodeId, spans?, attrs? }`) or
   * whole edited `SemanticUnit`s — the latter are auto-diffed against the live
   * document via `unitRichHash`, so the model never states which blocks changed
   * (unchanged units are skipped). A `RichBlockEdit.expectedContentHash` (or a
   * unit whose source hash the caller pins) is the stale-edit guard: if the
   * block's current rich hash differs, the edit is skipped as `stale` rather
   * than clobbering newer content.
   *
   * When TrackChanges is installed, applies as tracked suggestions — an agent's
   * edit is a proposal, and a reviewer accepts or rejects it. Applying agent
   * output straight into the document is `applyAiSuggestion({ mode: "direct" })`.
   */
  applyRichEdit(
    edits: RichBlockEdit[] | SemanticUnit[],
    options: { authorID?: string } = {},
  ): { applied: boolean; changed: string[]; stale: string[]; notFound: string[]; rejected: string[] } {
    const authorID = options.authorID ?? "AI Assistant";

    // The units as they stand — the freshness base for both auto-diff (which
    // units changed) and the stale guard (did the doc move under us). Ids are
    // unique at the source, so an id names one block; a document saved before
    // that held may name two, and an edit to such an id is refused, not guessed.
    const read = unitsToRead(toSemanticUnits(this.editor, { groupBlocks: false }), this.editor.getState().doc);
    const unitsById = blocksById(read, (u) => u.id);
    const partsById = blocksById(read.flatMap((u) => u.parts ?? []), (part) => part.nodeId);

    const resolved: RichBlockEdit[] = [];
    const changed: string[] = [];
    const stale: string[] = [];
    const notFound: string[] = [];
    // An image unit has no words to diff; its layout is set as image attrs.
    const imageLayouts: ImageLayoutEdit[] = [];
    const rejected: string[] = [];
    // Only the fields that change are checked: an image placed by drag reads
    // `align: "custom"`, which an agent cannot set but may hand back untouched.
    const queueImageLayout = (nodeId: string, current: SemanticUnit, proposed: unknown) => {
      const changes = changedImageFields(current.image, proposed);
      const parsed = SemanticImageAttrsSchema.strict().safeParse(changes);
      if (parsed.success && Object.keys(parsed.data).length > 0) imageLayouts.push({ nodeId, attrs: parsed.data });
      else rejected.push(nodeId);
    };

    for (const item of edits) {
      if (isSemanticUnit(item)) {
        const nodeId = item.nodeIds[0];
        if (!nodeId) continue;
        const named = unitsById.get(nodeId);
        const candidates = meant(named, !!item.proposedForDeletion);
        if (candidates.length === 0) {
          notFound.push(nodeId);
          continue;
        }
        const sourceHash = sourceHashOf(item);
        const pinned = sourceHash === undefined ? candidates : candidates.filter((c) => unitRichHash(c) === sourceHash);
        if (pinned.length === 0) {
          stale.push(nodeId);
          continue;
        }
        if (pinned.some((c) => unitRichHash(unitWithCurrentChanges(item, c)) === unitRichHash(c))) continue; // unchanged — skip
        const [currentUnit] = pinned;
        // A block proposed for deletion is not there to edit, and an id two
        // live blocks carry does not say which one.
        if (!currentUnit || currentUnit.proposedForDeletion || (named?.live.length ?? 0) > 1) {
          rejected.push(nodeId);
          continue;
        }
        if (currentUnit.type === "image") {
          if (stableStringify(item.attrs ?? {}) === stableStringify(currentUnit.attrs ?? {})) queueImageLayout(nodeId, currentUnit, item.image);
          else rejected.push(nodeId);
          continue;
        }

        // Container units are context envelopes; their individually-addressable
        // parts are the edit surface. Diff those leaves and never send the
        // container itself to the leaf-only merge engine.
        if (item.parts || currentUnit.parts) {
          for (const part of item.parts ?? []) {
            const partNamed = partsById.get(part.nodeId);
            const partCandidates = meant(partNamed, !!part.proposedForDeletion);
            if (partCandidates.length === 0) {
              notFound.push(part.nodeId);
              continue;
            }
            if (partCandidates.some((c) => semanticPartRichHash(withCurrentChanges(part, c)) === semanticPartRichHash(c))) continue;
            if (partCandidates[0]?.proposedForDeletion || (partNamed?.live.length ?? 0) > 1) {
              rejected.push(part.nodeId);
              continue;
            }
            resolved.push(editForPart(part));
            changed.push(part.nodeId);
          }
          continue;
        }

        changed.push(nodeId);
        // A plain-text edit has no `spans`; synthesize one unformatted run so
        // the inline diff still sees the new text.
        resolved.push({
          nodeId,
          spans: item.spans ?? [{ text: item.text, marks: [] }],
          ...(item.attrs ? { attrs: item.attrs } : {}),
          expectedContentHash: sourceHash ?? unitRichHash(currentUnit),
        });
      } else {
        // An edit named only by id lands on the live block it names.
        const unit = unitsById.get(item.nodeId)?.live;
        const part = partsById.get(item.nodeId)?.live;
        const live = [...(unit ?? []), ...(part ?? [])];
        if (live.length > 1) {
          rejected.push(item.nodeId);
          continue;
        }
        const currentHash = unit?.[0] ? unitRichHash(unit[0]) : part?.[0] ? semanticPartRichHash(part[0]) : undefined;
        if (item.expectedContentHash !== undefined && currentHash !== item.expectedContentHash) {
          stale.push(item.nodeId);
          continue;
        }
        if (unit?.[0]?.type === "image") {
          if (item.spans) rejected.push(item.nodeId);
          else queueImageLayout(item.nodeId, unit[0], item.attrs);
          continue;
        }
        resolved.push(item);
        changed.push(item.nodeId);
      }
    }

    const laidOut = imageLayouts.length > 0 ? applyImageLayout(this.editor, imageLayouts, authorID) : [];
    rejected.push(...imageLayouts.map((edit) => edit.nodeId).filter((nodeId) => !laidOut.includes(nodeId)));
    if (resolved.length === 0) {
      return { applied: laidOut.length > 0, changed: [...changed, ...laidOut], stale, notFound, rejected };
    }

    const result = applyRichDiffAsSuggestion(
      this.editor.getState(),
      (tr) => this.editor.applyTransaction(tr),
      { edits: resolved, authorID },
    );
    const unapplied = new Set([...result.notFound, ...result.rejected]);
    return {
      applied: result.applied || laidOut.length > 0,
      changed: [...changed.filter((nodeId) => !unapplied.has(nodeId)), ...laidOut],
      stale,
      notFound: [...notFound, ...result.notFound],
      rejected: [...rejected, ...result.rejected],
    };
  }

  /**
   * Apply zod-validated protocol edits (from `parseSemanticEdits` /
   * `SemanticEditSchema`) as tracked suggestions.
   *
   * Routes on `kind`: `richText` goes to the leaf merge, structural ops to
   * `applyStructuralEdits`. Both report into one result; `stale` comes only from
   * the rich half, which is the only one with a hash to check against.
   *
   * When TrackChanges is installed, every edit is a proposal by `authorID`
   * (default "AI Assistant"), tracked whether or not the person is suggesting.
   *
   * A batch lands in up to three transactions, so up to three undo steps: image
   * layouts, text edits, then structural ops.
   */
  applySemanticEdits(
    edits: SemanticEdit[],
    options: { authorID?: string } = {},
  ): { applied: boolean; changed: string[]; stale: string[]; notFound: string[]; rejected: string[] } {
    const rich: RichBlockEdit[] = [];
    const structural: StructuralSemanticEdit[] = [];
    for (const edit of edits) {
      if (edit.kind === "richText") {
        rich.push({
          nodeId: edit.nodeId,
          ...(edit.spans ? { spans: toCoreSpans(edit.spans) } : {}),
          ...(edit.attrs ? { attrs: edit.attrs } : {}),
          ...(edit.expectedContentHash ? { expectedContentHash: edit.expectedContentHash } : {}),
        });
      } else {
        structural.push(edit);
      }
    }

    const richResult = rich.length > 0
      ? this.applyRichEdit(rich, options)
      : { applied: false, changed: [], stale: [], notFound: [], rejected: [] };
    if (structural.length === 0) return richResult;

    // One transaction: the structural batch is one undo step.
    const tr = trackAsSuggestion(this.editor.getState().tr, options.authorID ?? "AI Assistant");
    const structuralResult = applyStructuralEdits(tr, structural);
    const touched = tr.docChanged;
    if (touched) this.editor.applyTransaction(tr);

    return {
      applied: richResult.applied || touched,
      changed: [...richResult.changed, ...structuralResult.changed],
      stale: richResult.stale,
      notFound: [...richResult.notFound, ...structuralResult.notFound],
      rejected: [...richResult.rejected, ...structuralResult.rejected],
    };
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  /**
   * Streams content cosmetically as ghost text after the anchor block.
   * The document is NOT modified during streaming — this is purely visual.
   *
   * Returns the full accumulated text when the stream ends.
   * Dispatches are debounced to at most one per animation frame (16ms) to
   * avoid per-token repaints during fast LLM streams.
   *
   * @param nodeId  The stable nodeId of the block to append ghost text after
   * @param stream  An AsyncIterable of text chunks (e.g. from a fetch SSE stream)
   */
  async streamGhostText(
    nodeId: string,
    stream: AsyncIterable<string>,
  ): Promise<string> {
    const editor = this.editor;
    let accumulated = "";

    // Position the AI caret at the end of the anchor block
    const found = findLiveNodeById(editor.getState().doc, nodeId);
    if (found) {
      const endPos = found.pos + found.node.nodeSize;
      editor.applyTransaction(
        editor.getState().tr
          .setMeta(aiCaretPluginKey, { position: endPos })
          .setMeta("addToHistory", false),
      );
    }

    // Debounce: batch chunk updates into animation frames
    let pendingDispatch = false;

    const flush = () => {
      pendingDispatch = false;
      editor.applyTransaction(
        editor.getState().tr
          .setMeta(ghostTextPluginKey, { nodeId, content: accumulated })
          .setMeta("addToHistory", false),
      );
    };

    try {
      for await (const chunk of stream) {
        accumulated += chunk;
        if (!pendingDispatch) {
          pendingDispatch = true;
          // Schedule a flush at the next animation frame
          if (typeof requestAnimationFrame !== "undefined") {
            requestAnimationFrame(flush);
          } else {
            // Node.js / test environment fallback
            setTimeout(flush, 16);
          }
        }
      }

      // Ensure final state is dispatched after stream ends
      flush();
    } catch (err) {
      this.clearGhostText();
      this.clearAiCaret();
      throw err;
    }

    return accumulated;
  }

  /** Clear the ghost text decoration immediately. */
  clearGhostText(): void {
    this.editor.applyTransaction(
      this.editor.getState().tr
        .setMeta(ghostTextPluginKey, { nodeId: null, content: "" })
        .setMeta("addToHistory", false),
    );
  }

  /** Clear the AI caret decoration immediately. */
  clearAiCaret(): void {
    this.editor.applyTransaction(
      this.editor.getState().tr
        .setMeta(aiCaretPluginKey, { position: null })
        .setMeta("addToHistory", false),
    );
  }

  /**
   * Stream ghost text cosmetically, then commit the result as a tracked change
   * (or direct insert if TrackChanges is not active). This is the primary
   * method for AI-generated content.
   *
   * Flow:
   *   1. Cosmetic streaming → ghost text grows, AI caret pulses
   *   2. Stream ends → ghost text cleared, AI caret cleared
   *   3. Content inserted after anchor block as a real document transaction
   *      tagged with `track-author` so TrackChanges wraps it
   *
   * @param nodeId   Anchor block to insert content after
   * @param stream   AsyncIterable of text chunks
   * @param authorId Defaults to "ai:assistant" — used for TrackChanges attribution
   */
  async generateSuggestion(
    nodeId: string,
    stream: AsyncIterable<string>,
    options?: { authorId?: string },
  ): Promise<void> {
    const authorId = options?.authorId ?? "ai:assistant";

    // Phase 1: stream cosmetically
    const generated = await this.streamGhostText(nodeId, stream);

    // Phase 2: clear cosmetic overlays
    this.clearGhostText();
    this.clearAiCaret();

    if (!generated) return;

    // Phase 3: one atomic insert, which TrackChanges records as a single change.
    const state = this.editor.getState();
    const found = findLiveNodeById(state.doc, nodeId);
    if (!found) return;

    const schema = state.schema as Schema;
    const paragraphType = schema.nodes["paragraph"];
    if (!paragraphType) return;

    // Insert a new paragraph with the generated text after the anchor block
    const insertPos = found.pos + found.node.nodeSize;
    const newNode   = paragraphType.createAndFill(
      {},
      schema.text(generated),
    );
    if (!newNode) return;

    const tr = state.tr
      .insert(insertPos, newNode)
      .setMeta("track-author", authorId)  // TrackChanges reads this
      .scrollIntoView();

    this.editor.applyTransaction(tr);
  }
}

// ── AiToolkitOptions ─────────────────────────────────────────────────────────

interface AiToolkitOptions {
  /** Set false to exclude the UniqueId sub-extension. Default: true. */
  uniqueId?: false;
  /** Set false to exclude the GhostText sub-extension. Default: true. */
  ghostText?: false;
  /** Set false to exclude the AiCaret sub-extension. Default: true. */
  aiCaret?: false;
  /** Set false to exclude the AiSuggestion sub-extension. Default: true. */
  aiSuggestion?: false;
}

// ── AiToolkit extension ───────────────────────────────────────────────────────

/**
 * AiToolkit — opt-in extension that bundles UniqueId, GhostText, and AiCaret,
 * and exposes the AiToolkitAPI via getAiToolkit().
 *
 * Add this to your extensions array to enable AI capabilities:
 *
 * @example
 * import { StarterKit, AiToolkit } from "@scrivr/core";
 * import { getAiToolkit } from "@scrivr/core";
 *
 * const editor = new Editor({ extensions: [StarterKit, AiToolkit] });
 * const ai = getAiToolkit(editor);
 *
 * // Stream AI content
 * await ai.generateSuggestion(nodeId, myStream);
 *
 * // Read document context
 * const ctx = ai.getContext({ beforeChars: 1000 });
 */
export const AiToolkit = Extension.create<AiToolkitOptions>({
  name: "aiToolkit",

  addProseMirrorPlugins() {
    const plugins = [];
    if (this.options.uniqueId !== false) {
      plugins.push(...UniqueId.resolve(this.schema).plugins);
    }
    if (this.options.ghostText !== false) {
      plugins.push(...GhostText.resolve(this.schema).plugins);
    }
    if (this.options.aiCaret !== false) {
      plugins.push(...AiCaret.resolve(this.schema).plugins);
    }
    if (this.options.aiSuggestion !== false) {
      plugins.push(...AiSuggestionExtension.resolve(this.schema).plugins);
    }
    return plugins;
  },

  addCommands() {
    const cmds: Record<string, (...args: unknown[]) => Command> = {};
    if (this.options.ghostText !== false) {
      Object.assign(cmds, GhostText.resolve(this.schema).commands);
    }
    if (this.options.aiCaret !== false) {
      Object.assign(cmds, AiCaret.resolve(this.schema).commands);
    }
    return cmds;
  },

  onEditorReady(editor: IBaseEditor) {
    // The AiToolkitAPI only needs `IBaseEditor` methods (getState,
    // applyTransaction, getMarkdown, schema), so register it here — fires in
    // both the browser `Editor` and headless `ServerEditor`. Overlay painting
    // is wired separately in `onViewReady` (view-only).
    const hasSuggestion = this.options.aiSuggestion !== false;
    const api = new AiToolkitAPI(editor, hasSuggestion);
    aiToolkitRegistry.set(editor, api);

    return () => {
      aiToolkitRegistry.delete(editor);
    };
  },

  onViewReady(editor: IEditor) {
    // The sub-extensions (GhostText / AiCaret / AiSuggestion) are all
    // view-only — they paint overlays. Compose their `viewReadyCallback`s
    // here so the consumer registers them transitively without having to
    // list each in the extensions array.
    const cleanups: Array<() => void> = [];

    if (this.options.ghostText !== false) {
      const cleanup = GhostText.resolve().viewReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }
    if (this.options.aiCaret !== false) {
      const cleanup = AiCaret.resolve().viewReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }
    if (this.options.aiSuggestion !== false) {
      const cleanup = AiSuggestionExtension.resolve().viewReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }

    return () => {
      cleanups.forEach((c) => c());
    };
  },
});
