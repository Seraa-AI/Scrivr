/**
 * Surface management for header/footer live editing.
 *
 * Builds a restricted schema (no tables, page breaks, floats) and lazily
 * creates EditorSurface instances per slot. Surfaces are cached so
 * re-activation after Escape + re-click is free.
 */

import { Schema } from "prosemirror-model";
import type { NodeSpec, MarkSpec } from "prosemirror-model";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { EditorSurface } from "@scrivr/core";
import type { HeaderFooterDefinition } from "./types";

export type SlotKey =
  | "defaultHeader"
  | "defaultFooter"
  | "firstPageHeader"
  | "firstPageFooter";

/** Node types that are NOT allowed in header/footer content. */
const BLOCKED_NODES = new Set([
  "table",
  "tableRow",
  "tableCell",
  "pageBreak",
]);

/**
 * Build a restricted schema from the main schema by filtering out nodes
 * that don't belong in header/footer content.
 */
export function buildRestrictedSchema(mainSchema: Schema): Schema {
  const nodes: Record<string, NodeSpec> = {};
  mainSchema.spec.nodes.forEach((name, spec) => {
    if (BLOCKED_NODES.has(name)) return;
    nodes[name] = spec;
  });

  // Override doc content to only allow block nodes (no tables)
  if (nodes["doc"]) {
    nodes["doc"] = { ...nodes["doc"], content: "block+" };
  }

  const marks: Record<string, MarkSpec> = {};
  mainSchema.spec.marks.forEach((name, spec) => {
    marks[name] = spec;
  });

  return new Schema({ nodes, marks });
}

/**
 * Lazy cache for EditorSurface instances. One surface per slot key.
 * Surfaces are created on first activation and reused on subsequent activations.
 */
export class HeaderFooterSurfaceCache {
  private surfaces = new Map<SlotKey, EditorSurface>();
  private schema: Schema;

  constructor(mainSchema: Schema) {
    this.schema = buildRestrictedSchema(mainSchema);
  }

  /** Get or create a surface for the given slot. */
  getOrCreate(slotKey: SlotKey, def: HeaderFooterDefinition): EditorSurface {
    const existing = this.surfaces.get(slotKey);
    if (existing) return existing;

    const surface = new EditorSurface({
      id: `headerFooter:${slotKey}`,
      owner: "headerFooter",
      schema: this.schema,
      initialDocJSON: JSON.parse(JSON.stringify(def.content)),
      plugins: [
        history(),
        keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }),
        keymap(baseKeymap),
      ],
    });

    this.surfaces.set(slotKey, surface);
    return surface;
  }

  /** Get an existing surface without creating. */
  get(slotKey: SlotKey): EditorSurface | undefined {
    return this.surfaces.get(slotKey);
  }

  /** Determine which slot key a surface belongs to from its id. */
  static slotKeyFromId(surfaceId: string): SlotKey | null {
    const prefix = "headerFooter:";
    if (!surfaceId.startsWith(prefix)) return null;
    const key = surfaceId.slice(prefix.length);
    if (
      key === "defaultHeader" ||
      key === "defaultFooter" ||
      key === "firstPageHeader" ||
      key === "firstPageFooter"
    ) {
      return key;
    }
    return null;
  }

  /** All cached surfaces — for teardown/unregister. */
  all(): EditorSurface[] {
    return Array.from(this.surfaces.values());
  }
}
