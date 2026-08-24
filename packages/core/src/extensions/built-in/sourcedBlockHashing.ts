import { Fragment, type Node } from "prosemirror-model";
import { Plugin, PluginKey, EditorState, Transaction } from "prosemirror-state";
import { fnv1aHex, stableStringify } from "../../model/hash";

interface EditorViewLike {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}

export const NORMALIZER_VERSION = 1;

export function normalizeSourcedBlock(fragment: Fragment): unknown[] {
  const walkNode = (node: Node): unknown => {
    // 1. Strip out transient attributes (like nodeId)
    const cleanAttrs = { ...node.attrs };
    if ("nodeId" in cleanAttrs) delete cleanAttrs.nodeId;
    if ("selectionId" in cleanAttrs) delete cleanAttrs.selectionId;

    // 2. Filter out Tracked Changes
    const cleanMarks = node.marks
      .filter((mark) => mark.type.name !== "trackedInsert" && mark.type.name !== "trackedDelete")
      .map((mark) => ({ type: mark.type.name, attrs: mark.attrs }));

    if (node.isText) {
      return { type: "text", text: node.text, ...(cleanMarks.length > 0 ? { marks: cleanMarks } : {}) };
    }

    // Recursively walk children
    const children: unknown[] = [];
    node.content.forEach((child) => children.push(walkNode(child)));

    return {
      type: node.type.name,
      ...(Object.keys(cleanAttrs).length > 0 ? { attrs: cleanAttrs } : {}),
      ...(children.length > 0 ? { content: children } : {}),
      ...(cleanMarks.length > 0 ? { marks: cleanMarks } : {}),
    };
  };

  const content: unknown[] = [];
  fragment.forEach((child) => content.push(walkNode(child)));
  return content;
}

export function computeBlockHash(fragment: Fragment): string {
  const normalizedJSON = normalizeSourcedBlock(fragment);
  return fnv1aHex(stableStringify(normalizedJSON));
}

export interface SourcedBlockDivergenceState {
  modifiedBlocks: Set<number>;
}

export const sourcedBlockDivergenceKey = new PluginKey<SourcedBlockDivergenceState>("sourcedBlockDivergence");

export function sourcedBlockDivergencePlugin() {
  return new Plugin({
    key: sourcedBlockDivergenceKey,
    state: {
      init() {
        return { modifiedBlocks: new Set<number>() };
      },
      apply(tr, value) {
        let nextSet = value.modifiedBlocks;
        if (tr.docChanged) {
          nextSet = new Set();
          for (const pos of value.modifiedBlocks) {
            const mapped = tr.mapping.map(pos);
            nextSet.add(mapped);
          }
        }

        const meta = tr.getMeta(sourcedBlockDivergenceKey);
        if (meta && Array.isArray(meta)) {
          const newSet = new Set(nextSet);
          for (const { pos, isModified } of meta) {
            if (isModified) {
              newSet.add(pos);
            } else {
              newSet.delete(pos);
            }
          }
          return { modifiedBlocks: newSet };
        }
        
        return { modifiedBlocks: nextSet };
      }
    },
    view(view: EditorViewLike) {
      let timeoutId: ReturnType<typeof setTimeout>;

      return {
        update(view: EditorViewLike, prevState: EditorState) {
          const state = view.state;
          
          if (prevState.doc.eq(state.doc)) return;

          clearTimeout(timeoutId);

          timeoutId = setTimeout(() => {
            const updates: Array<{ pos: number, isModified: boolean }> = [];
            
            state.doc.descendants((node: Node, pos: number) => {
              if (node.type.name === "sourcedBlock") {
                const currentHash = computeBlockHash(node.content);
                const isModified = currentHash !== node.attrs["baseHash"];
                
                const pluginState = sourcedBlockDivergenceKey.getState(state);
                const wasModified = pluginState?.modifiedBlocks.has(pos) ?? false;

                if (isModified !== wasModified) {
                  updates.push({ pos, isModified });
                }
              }
              return false; // don't descend into sourcedBlock's children
            });

            if (updates.length > 0) {
              view.dispatch(state.tr.setMeta(sourcedBlockDivergenceKey, updates));
            }
          }, 500);
        },
        
        destroy() {
          clearTimeout(timeoutId);
        }
      };
    }
  });
}
