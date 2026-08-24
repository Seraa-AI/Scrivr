import { Plugin, PluginKey } from "prosemirror-state";
import { Extension } from "../Extension";
import { Slice, Fragment, Node } from "prosemirror-model";
import { cloneSourcedBlocks } from "./cloneSourcedBlocks";
import { sourcedBlockDivergencePlugin, computeBlockHash, NORMALIZER_VERSION } from "./sourcedBlockHashing";
import type { SourceProvider, SourceContent } from "./SourcedBlock.types";

export interface SourcedBlockOptions {
  providers?: SourceProvider[];
}

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    sourcedBlock: {
      insertSourcedBlock: (options: { kind: string; content: SourceContent }) => ReturnType;
    };
  }
}

export function remintSourcedBlockIdentity(slice: Slice): Slice {
  function flattenFragment(fragment: Fragment, depth: number, openStart: number, openEnd: number): Node[] {
    const nodes: Node[] = [];
    fragment.forEach((node, offset, index) => {
      const isOpenStartEdge = index === 0 && depth < openStart;
      const isOpenEndEdge = index === fragment.childCount - 1 && depth < openEnd;
      
      if (node.type.name === "sourcedBlock") {
        if (isOpenStartEdge || isOpenEndEdge) {
          // Partial copy. Unwrap it entirely.
          nodes.push(...flattenFragment(node.content, depth + 1, openStart, openEnd));
        } else {
          // Full copy. Remint instanceId.
          const newId = `src_pasted_${Math.random().toString(36).substring(2, 11)}`;
          nodes.push(node.type.create({ ...node.attrs, instanceId: newId }, Fragment.from(flattenFragment(node.content, depth + 1, openStart, openEnd))));
        }
      } else if (node.content.size > 0) {
        nodes.push(node.copy(Fragment.from(flattenFragment(node.content, depth + 1, openStart, openEnd))));
      } else {
        nodes.push(node);
      }
    });
    return nodes;
  }

  return new Slice(Fragment.from(flattenFragment(slice.content, 0, slice.openStart, slice.openEnd)), slice.openStart, slice.openEnd);
}

// ── Reconciler ────────────────────────────────────────────────────────────────

export interface SourcedBlockRecord {
  instanceId: string | null;
  kind: string | null;
  resourceId: string | null;
  versionId: string | null;
  baseHash: string | null;
  baseNormalizer: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function collectSourcedBlocks(doc: Node): SourcedBlockRecord[] {
  const records: SourcedBlockRecord[] = [];

  doc.descendants((node) => {
    if (node.type.name !== "sourcedBlock") {
      return true; 
    }

    const attrs: unknown = node.attrs;
    
    if (isRecord(attrs)) {
      records.push({
        instanceId: parseStringOrNull(attrs["instanceId"]),
        kind: parseStringOrNull(attrs["kind"]),
        resourceId: parseStringOrNull(attrs["resourceId"]),
        versionId: parseStringOrNull(attrs["versionId"]),
        baseHash: parseStringOrNull(attrs["baseHash"]),
        baseNormalizer: parseNumberOrNull(attrs["baseNormalizer"]),
      });
    }

    return false; 
  });

  return records;
}

export const SourcedBlockExtension = Extension.create<SourcedBlockOptions>({
  name: "sourcedBlock",

  addNodes() {
    return {
      sourcedBlock: {
        content: "block+",
        group: "block",
        defining: true,
        isolating: false,
        attrs: {
          instanceId: { default: null },
          kind: { default: null },
          resourceId: { default: null },
          versionId: { default: null },
          baseHash: { default: null },
          baseNormalizer: { default: null },
        },
        parseDOM: [
          {
            tag: "div[data-sourced-block]",
            getAttrs: (dom) => {
              const el = dom as HTMLElement;
              const normalizerAttr = el.getAttribute("data-base-normalizer");
              return {
                instanceId: el.getAttribute("data-instance-id"),
                kind: el.getAttribute("data-kind"),
                resourceId: el.getAttribute("data-resource-id"),
                versionId: el.getAttribute("data-version-id"),
                baseHash: el.getAttribute("data-base-hash"),
                baseNormalizer: normalizerAttr ? parseInt(normalizerAttr, 10) : 1,
              };
            },
          },
        ],
        toDOM: (node) => {
          return [
            "div",
            {
              "data-sourced-block": "true",
              "data-instance-id": node.attrs["instanceId"],
              "data-kind": node.attrs["kind"],
              "data-resource-id": node.attrs["resourceId"],
              "data-version-id": node.attrs["versionId"],
              "data-base-hash": node.attrs["baseHash"],
              "data-base-normalizer": node.attrs["baseNormalizer"],
            },
            0,
          ];
        },
      },
    };
  },

  addCommands() {
    return {
      insertSourcedBlock: (options: { kind: string; content: SourceContent }) => (state, dispatch) => {
        const { kind, content } = options;
        const schema = state.schema;

        try {
          // Assume contentJSON is a Node (e.g. { type: "doc", content: [...] })
          // or at least a block node containing the actual content
          const parsedNode = schema.nodeFromJSON(content.contentJSON);
          const fragment = parsedNode.content;
          
          if (dispatch) {
            const tr = state.tr;
            const instanceId = `src_${Math.random().toString(36).substring(2, 11)}`;
            const baseHash = computeBlockHash(fragment);

            const blockType = schema.nodes["sourcedBlock"];
            if (!blockType) return false;

            const blockNode = blockType.create({
              instanceId,
              kind,
              resourceId: content.resourceId,
              versionId: content.versionId,
              baseHash,
              baseNormalizer: NORMALIZER_VERSION,
            }, fragment);

            tr.replaceSelectionWith(blockNode);
            dispatch(tr);

            const providers = this.options.providers ?? [];
            const provider = providers.find((p) => p.kind === kind);
            
            if (provider) {
              provider.registerInstance({
                instanceId,
                resourceId: content.resourceId,
                versionId: content.versionId,
                kind,
              }).catch((error: unknown) => {
                console.error("[SourcedBlock] Failed to register instance:", error);
              });
            }
          }

          return true;
        } catch (error: unknown) {
          console.error("[SourcedBlock] Invalid contentJSON provided to insertSourcedBlock", error);
          return false;
        }
      },
    };
  },

  addCloneHandlers() {
    return [cloneSourcedBlocks];
  },

  addProseMirrorPlugins() {
    return [
      sourcedBlockDivergencePlugin(),
      new Plugin({
        key: new PluginKey("sourcedBlockNormalization"),
        appendTransaction(transactions, _oldState, newState) {
          const hasDocChange = transactions.some((tr) => tr.docChanged);
          if (!hasDocChange) return null;

          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (node.type.name === "sourcedBlock") {
              // Rule 1: Empty wrapper normalization
              if (node.textContent === "") {
                tr.replaceWith(pos, pos + node.nodeSize, node.content);
                modified = true;
                return false;
              }

              // Rule 2: No nested sourcedBlocks
              node.forEach((child, offset) => {
                if (child.type.name === "sourcedBlock") {
                  const childPos = pos + 1 + offset;
                  tr.replaceWith(childPos, childPos + child.nodeSize, child.content);
                  modified = true;
                }
              });
            }
          });

          if (modified) {
            tr.setStoredMarks(newState.storedMarks);
            return tr;
          }
          return null;
        },
        props: {
          transformPasted(slice) {
            return remintSourcedBlockIdentity(slice);
          }
        }
      })
    ];
  }
});
