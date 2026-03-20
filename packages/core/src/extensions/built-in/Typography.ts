import { InputRule } from "prosemirror-inputrules";
import { Extension } from "../Extension";

/**
 * Typography — smart punctuation input rules.
 *
 * Converts ASCII shortcuts to proper typographic characters while typing:
 *   --      → — (em dash)
 *   ...     → … (ellipsis)
 *   "text   → "text  (smart double quotes, context-sensitive open/close)
 *   'text   → 'text  (smart single quotes, context-sensitive open/close)
 *
 * Disable entirely: StarterKit.configure({ typography: false })
 */
export const Typography = Extension.create({
  name: "typography",

  addInputRules() {
    return [
      // Em dash: typing "--" → "—"
      new InputRule(/--$/, (state, _match, start, end) =>
        state.tr.insertText("\u2014", start, end),
      ),

      // Ellipsis: typing "..." → "…"
      new InputRule(/\.\.\.$/, (state, _match, start, end) =>
        state.tr.insertText("\u2026", start, end),
      ),

      // Smart double quotes — open after whitespace/start, close otherwise
      new InputRule(/"$/, (state, _match, start, end) => {
        const before = start > 0 ? state.doc.textBetween(start - 1, start) : "";
        const quote = !before || /[\s([]/.test(before) ? "\u201C" : "\u201D";
        return state.tr.insertText(quote, start, end);
      }),

      // Smart single quotes — open after whitespace/start, close otherwise
      // Note: apostrophes in contractions (don't, it's) become right single quote — correct.
      new InputRule(/'$/, (state, _match, start, end) => {
        const before = start > 0 ? state.doc.textBetween(start - 1, start) : "";
        const quote = !before || /[\s([]/.test(before) ? "\u2018" : "\u2019";
        return state.tr.insertText(quote, start, end);
      }),
    ];
  },
});
