/**
 * Public ingestion-time normalization for any ProseMirror document
 * entering the editor or a server-side AI pipeline.
 *
 * One call composes the building blocks already in core:
 *   1. parse JSON via `schema.nodeFromJSON`
 *   2. bounds check (maxNodes / maxDepth)
 *   3. URL allow-list sweep — `sanitizeDocUrls`
 *   4. table integrity repair — `normalizeTablesDoc`
 *   5. block-ID assignment — `assignBlockIds`
 *   6. structural fingerprint
 *
 * The result tells the caller (a) what was repaired (`warnings`), (b)
 * whether anything was repaired (`changed`), and (c) a deterministic
 * `fingerprint` for cheap round-trip equality checks — the building
 * block the upcoming `diffDocuments` will use to skip work on
 * equivalent inputs.
 *
 * Two modes:
 *  - `"repair"` (default) — every stage runs; failures become warnings
 *    and the function returns a best-effort doc.
 *  - `"strict"` — bounds violations throw `RangeError`. URL / table /
 *    ID stages still repair (the doc would otherwise be unusable),
 *    but their warnings remain in the result so snapshot tests catch
 *    silent drift.
 *
 * @example
 *   const result = normalizeDocument(jsonFromAi, { schema, maxNodes: 5000 });
 *   if (result.warnings.some(w => w.code === "urls-sanitized")) {
 *     rejectAiOutput(); // model produced an unsafe link/src
 *   }
 *   await db.save(result.doc.toJSON());
 */
import { Node, type Schema } from "prosemirror-model";
import { sanitizeDocUrls } from "./sanitizeDocUrls";
import {
  assignBlockIds,
  planBlockIdAssignments,
} from "./assignBlockIds";
import { normalizeTablesDoc } from "../table/normalize";

export type NormalizeMode = "repair" | "strict";

export type NormalizeWarningCode =
  | "urls-sanitized"
  | "tables-normalized"
  | "ids-assigned"
  | "bounds-exceeded";

export interface NormalizeWarning {
  code: NormalizeWarningCode;
  message: string;
  /** Number of nodes affected, when cheaply available. */
  count?: number;
}

export interface NormalizeDocumentOptions {
  /** Required — the schema the input is being parsed against. */
  schema: Schema;
  /** "repair" (default) returns a best-effort doc; "strict" throws on bounds. */
  mode?: NormalizeMode;
  /** Stamp `nodeId` on blocks whose schema declares it. Default: true. */
  assignIds?: boolean;
  /** Override the ID generator (deterministic IDs in tests). */
  generate?: () => string;
  /** Reject docs with more than this many nodes. */
  maxNodes?: number;
  /** Reject docs deeper than this many nesting levels. */
  maxDepth?: number;
}

export interface NormalizeResult {
  /** The normalized doc, valid against the schema. */
  doc: Node;
  /** Per-stage warnings — at most one entry per stage. */
  warnings: NormalizeWarning[];
  /** Stable hash of the normalized doc. Two equal docs produce equal hashes. */
  fingerprint: string;
  /** True when normalization mutated the input. */
  changed: boolean;
}

export function normalizeDocument(
  input: Record<string, unknown> | Node,
  options: NormalizeDocumentOptions,
): NormalizeResult {
  const { schema } = options;
  const mode = options.mode ?? "repair";
  const assignIds = options.assignIds ?? true;
  const warnings: NormalizeWarning[] = [];

  // 1. Parse if needed. Callers already holding a Node (e.g. BaseEditor's
  //    constructor after parsing markdown or building the extension default)
  //    skip the JSON round-trip. JSON input goes through `nodeFromJSON`,
  //    which enforces schema validity here — required attrs, content
  //    expressions, mark allowance. Malformed JSON throws regardless of mode;
  //    "repair" cannot invent missing structure.
  const parsed = input instanceof Node ? input : schema.nodeFromJSON(input);

  // 2. Bounds. Cheap walk — count once, compare to both limits.
  const bounds = measureBounds(parsed);
  if (
    (options.maxNodes !== undefined && bounds.nodes > options.maxNodes) ||
    (options.maxDepth !== undefined && bounds.depth > options.maxDepth)
  ) {
    const detail = describeBoundsBreach(bounds, options);
    if (mode === "strict") {
      throw new RangeError(`[normalizeDocument] ${detail}`);
    }
    warnings.push({ code: "bounds-exceeded", message: detail });
  }

  // 3. URL allow-list. Same-ref on no-op.
  let doc = parsed;
  const sanitized = sanitizeDocUrls(doc, schema);
  if (sanitized !== doc) {
    warnings.push({
      code: "urls-sanitized",
      message: "Stripped one or more unsafe URLs from the document.",
    });
    doc = sanitized;
  }

  // 4. Table integrity. Same-ref on no-op.
  const tableNormalized = normalizeTablesDoc(doc, schema);
  if (tableNormalized !== doc) {
    warnings.push({
      code: "tables-normalized",
      message: "Repaired one or more tables (cell spans, vMerge, grid).",
    });
    doc = tableNormalized;
  }

  // 5. Block IDs. Use planBlockIdAssignments first so we know the count
  //    cheaply, then materialise via assignBlockIds (single tree walk).
  if (assignIds) {
    const plan = planBlockIdAssignments(doc, options.generate ? { generate: options.generate } : {});
    if (plan.length > 0) {
      doc = assignBlockIds(doc, options.generate ? { generate: makeReplayGenerator(plan) } : {});
      warnings.push({
        code: "ids-assigned",
        message: `Assigned nodeId to ${plan.length} block(s).`,
        count: plan.length,
      });
    }
  }

  return {
    doc,
    warnings,
    fingerprint: fingerprintOf(doc),
    changed: doc !== parsed,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface DocBounds {
  nodes: number;
  depth: number;
}

function measureBounds(doc: Node): DocBounds {
  let nodes = 0;
  let depth = 1;
  doc.descendants((_node, _pos, _parent, _index) => {
    nodes++;
    return true;
  });
  // Depth = the deepest descendant's distance from the root. ProseMirror
  // gives us `parent` at each step but not absolute depth; walk again
  // with a stack rather than rely on positions (cheap, no allocations).
  const stack: Array<{ node: Node; d: number }> = [{ node: doc, d: 1 }];
  while (stack.length > 0) {
    const { node, d } = stack.pop()!;
    if (d > depth) depth = d;
    node.forEach((child) => stack.push({ node: child, d: d + 1 }));
  }
  return { nodes, depth };
}

function describeBoundsBreach(
  bounds: DocBounds,
  options: NormalizeDocumentOptions,
): string {
  const parts: string[] = [];
  if (options.maxNodes !== undefined && bounds.nodes > options.maxNodes) {
    parts.push(`maxNodes=${options.maxNodes} exceeded (${bounds.nodes})`);
  }
  if (options.maxDepth !== undefined && bounds.depth > options.maxDepth) {
    parts.push(`maxDepth=${options.maxDepth} exceeded (${bounds.depth})`);
  }
  return parts.join("; ");
}

/**
 * `planBlockIdAssignments` already burned IDs from the caller's
 * generator while computing the plan; replay them in order so
 * `assignBlockIds` doesn't generate a fresh second batch (which would
 * waste IDs and surprise tests that count generator calls).
 */
function makeReplayGenerator(
  plan: ReadonlyArray<{ attrs: Record<string, unknown> }>,
): () => string {
  let i = 0;
  return () => {
    const next = plan[i++];
    const id = next?.attrs["nodeId"];
    if (typeof id !== "string") {
      throw new Error("[normalizeDocument] internal: plan exhausted unexpectedly");
    }
    return id;
  };
}

/**
 * FNV-1a 32-bit hash over a deterministic JSON serialisation of the
 * doc. Non-cryptographic — the goal is cheap, sync, collision-resistant
 * enough for "did this doc change between two normalize calls?" not
 * tamper-evidence. Returned as 8 hex chars.
 */
function fingerprintOf(doc: Node): string {
  const json = sortedStringify(doc.toJSON());
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Stable stringify — object keys are emitted in sorted order so two
 * structurally-equal docs always produce identical strings regardless
 * of the order their attrs were authored.
 */
function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(sortedStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ":" + sortedStringify(obj[k]));
  }
  return "{" + parts.join(",") + "}";
}
