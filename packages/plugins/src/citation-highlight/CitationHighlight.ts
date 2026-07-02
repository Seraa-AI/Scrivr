import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import { Extension, renderSelection } from "@scrivr/core";
import type { IEditor, OverlayRenderHandler } from "@scrivr/core";

/** A document range referenced by an external citation (AI answer, source panel). */
export interface CitationRange {
  id: string;
  from: number;
  to: number;
}

export interface CitationHighlightState {
  citations: readonly CitationRange[];
}

export const citationHighlightPluginKey = new PluginKey<CitationHighlightState>(
  "citationHighlight",
);

export interface CitationHighlightOptions {
  /** Fill for the highlight rects. Translucent so text stays readable. */
  color: string;
}

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    citationHighlight: {
      /**
       * Highlight the given cited ranges, replacing any previous set.
       * Empty/inverted ranges are dropped; positions are clamped to the doc.
       */
      setCitationHighlights: (citations: CitationRange[]) => ReturnType;
      /**
       * Add one citation to the highlighted set, or update its range if the
       * id is already present. Other citations are untouched.
       */
      addCitationHighlight: (citation: CitationRange) => ReturnType;
      /**
       * Highlight the currently selected text as a citation
       * (id `cite-{from}-{to}`). No-op on an empty selection.
       */
      citeSelection: () => ReturnType;
      /** Remove one citation highlight by id. Unknown ids are a no-op. */
      removeCitationHighlight: (id: string) => ReturnType;
      /** Remove all citation highlights. */
      clearCitationHighlights: () => ReturnType;
    };
  }
}

function sanitize(citations: CitationRange[], state: EditorState): CitationRange[] {
  const max = state.doc.content.size;
  return citations
    .map((c) => ({
      id: c.id,
      from: Math.max(0, Math.min(c.from, max)),
      to: Math.max(0, Math.min(c.to, max)),
    }))
    .filter((c) => c.from < c.to);
}

function upsert(state: EditorState, citation: CitationRange): CitationRange[] {
  const current = citationHighlightPluginKey.getState(state)?.citations ?? [];
  return sanitize([...current.filter((c) => c.id !== citation.id), citation], state);
}

function setCitationsMeta(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  citations: CitationRange[],
): boolean {
  if (dispatch) {
    const next: CitationHighlightState = { citations };
    dispatch(
      state.tr.setMeta(citationHighlightPluginKey, next).setMeta("addToHistory", false),
    );
  }
  return true;
}

/**
 * CitationHighlight — paints translucent highlight rects over document ranges
 * that an external citation references (e.g. an AI answer citing a passage).
 *
 * The highlight is ephemeral view state: nothing is written into the document,
 * nothing syncs to collaborators, and undo history is untouched. Ranges live
 * in plugin state and remap through every edit; a citation whose text is
 * deleted disappears.
 *
 * State works headlessly on `ServerEditor`; only the painting is view-side.
 */
export const CitationHighlight = Extension.create<CitationHighlightOptions>({
  name: "citationHighlight",

  defaultOptions: {
    color: "rgba(250, 204, 21, 0.3)",
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<CitationHighlightState>({
        key: citationHighlightPluginKey,
        state: {
          init: () => ({ citations: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(citationHighlightPluginKey);
            if (meta !== undefined) return meta;
            if (!tr.docChanged) return value;

            // assoc 1 on `from` / -1 on `to`: text typed at either boundary
            // stays outside the highlight instead of growing it.
            const citations = value.citations
              .map((c) => ({
                id: c.id,
                from: tr.mapping.map(c.from, 1),
                to: tr.mapping.map(c.to, -1),
              }))
              .filter((c) => c.from < c.to);
            return { citations };
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setCitationHighlights:
        (citations: CitationRange[]) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) =>
          setCitationsMeta(state, dispatch, sanitize(citations, state)),

      addCitationHighlight:
        (citation: CitationRange) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) =>
          setCitationsMeta(state, dispatch, upsert(state, citation)),

      citeSelection:
        () =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          const { from, to } = state.selection;
          if (from === to) return false;
          const citation = { id: `cite-${from}-${to}`, from, to };
          return setCitationsMeta(state, dispatch, upsert(state, citation));
        },

      removeCitationHighlight:
        (id: string) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          const current =
            citationHighlightPluginKey.getState(state)?.citations ?? [];
          return setCitationsMeta(
            state,
            dispatch,
            current.filter((c) => c.id !== id),
          );
        },

      clearCitationHighlights:
        () =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) =>
          setCitationsMeta(state, dispatch, []),
    };
  },

  addToolbarItems() {
    return [
      {
        command: "citeSelection",
        label: "Cite",
        title: "Highlight selection as citation",
        group: "citation",
        isActive: () => false,
      },
      {
        command: "clearCitationHighlights",
        label: "Uncite",
        title: "Clear citation highlights",
        group: "citation",
        isActive: () => false,
      },
    ];
  },

  onViewReady(editor: IEditor) {
    const { color } = this.options;

    const handler: OverlayRenderHandler = (ctx, pageNumber, _pageConfig, charMap) => {
      const pluginState = citationHighlightPluginKey.getState(editor.getState());
      if (!pluginState || pluginState.citations.length === 0) return;

      for (const citation of pluginState.citations) {
        const lines = charMap
          .linesInRange(citation.from, citation.to)
          .filter((l) => l.page === pageNumber);
        const glyphs = charMap
          .glyphsInRange(citation.from, citation.to)
          .filter((g) => g.page === pageNumber);

        renderSelection(ctx, lines, glyphs, citation.from, citation.to, color);
      }
    };

    return editor.addOverlayRenderHandler(handler);
  },
});

/**
 * Highlight one cited range and scroll it into view — the "click a citation
 * chip, jump to the passage" affordance. Upserts into the existing highlight
 * set (other citations stay lit) and centers the range in the viewport.
 * Returns false when the range has no layout position (e.g. cited text was
 * deleted); the highlight set is still updated in that case.
 */
export function revealCitation(editor: IEditor, citation: CitationRange): boolean {
  const state = editor.getState();
  setCitationsMeta(state, (tr) => editor.applyTransaction(tr), upsert(state, citation));
  return editor.scrollRangeIntoView(citation.from, citation.to);
}
