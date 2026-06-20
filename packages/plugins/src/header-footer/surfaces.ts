/**
 * Surface management for header/footer live editing.
 *
 * Surfaces share the host editor's Schema so NodeType identity matches: when
 * the user presses Mod-Alt-1 inside a header, the InputBridge keymap fires
 * `setBlockType(editor.schema.nodes["heading"], …)` against the surface state,
 * and ProseMirror's `canChangeType` accepts the NodeType because it belongs to
 * the same Schema instance the surface doc was built from. Same applies to
 * every other extension command and toolbar action — they all work in headers
 * because the schema is shared.
 *
 * Disallowed nodes (tables, page breaks) are enforced via a
 * `filterTransaction` plugin instead of a separate Schema. That covers paste,
 * commands, and any external dispatcher with one mechanism, and keeps the
 * NodeType identity intact for everything else.
 */

import { Schema } from "prosemirror-model";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { Plugin } from "prosemirror-state";
import { EditorSurface } from "@scrivr/core";
import type { HeaderFooterDefinition } from "./types";

export type SlotKey =
  | "defaultHeader"
  | "defaultFooter"
  | "firstPageHeader"
  | "firstPageFooter";

/**
 * Node types disallowed inside header/footer content. Enforced as a
 * transaction filter on the surface (see `createBlockedNodeFilter`) — the
 * surface still shares the host schema, so commands and keymaps that target
 * allowed node types keep working with identical NodeType identity.
 */
export const HEADER_FOOTER_BLOCKED_NODES: ReadonlySet<string> = new Set([
  "table",
  "tableRow",
  "tableCell",
  "pageBreak",
]);

/**
 * Plugin that rejects any transaction whose resulting doc contains a blocked
 * node type. Covers paste, command insertions, and external dispatches in one
 * place — the surface schema does not have to diverge from the host.
 */
function createBlockedNodeFilter(blocked: ReadonlySet<string>): Plugin {
  return new Plugin({
    filterTransaction(tr) {
      if (!tr.docChanged) return true;
      let hasBlocked = false;
      tr.doc.descendants((node) => {
        if (hasBlocked) return false;
        if (blocked.has(node.type.name)) {
          hasBlocked = true;
          return false;
        }
        return undefined;
      });
      return !hasBlocked;
    },
  });
}

/**
 * Lazy cache for EditorSurface instances. One surface per slot key.
 * Surfaces are created on first activation and reused on subsequent activations.
 */
export class HeaderFooterSurfaceCache {
  private surfaces = new Map<SlotKey, EditorSurface>();
  private schema: Schema;

  constructor(schema: Schema) {
    this.schema = schema;
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
        createBlockedNodeFilter(HEADER_FOOTER_BLOCKED_NODES),
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
