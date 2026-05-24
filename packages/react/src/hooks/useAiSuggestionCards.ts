import { useEffect, useState } from "react";
import type { Editor } from "@scrivr/core";
import { subscribeToAiSuggestions } from "@scrivr/plugins";
import type {
  AiSuggestionCardActions,
  AiSuggestionCardData,
  AiSuggestionSubscribeOptions,
} from "@scrivr/plugins";

/**
 * Headless hook — use this if you want to build your own card UI.
 *
 * Returns the current card list and action functions. Automatically
 * re-renders when the editor state changes.
 */
export function useAiSuggestionCards(
  editor: Editor | null,
  options?: AiSuggestionSubscribeOptions,
): {
  cards: AiSuggestionCardData[];
  actions: AiSuggestionCardActions | null;
} {
  const [state, setState] = useState<{
    cards: AiSuggestionCardData[];
    actions: AiSuggestionCardActions | null;
  }>({ cards: [], actions: null });

  useEffect(() => {
    if (!editor) {
      setState({ cards: [], actions: null });
      return;
    }

    const unsub = subscribeToAiSuggestions(
      editor,
      (cards, actions) => setState({ cards, actions }),
      options,
    );

    return unsub;
    // options is intentionally excluded — callers should stabilise it with useMemo/useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return state;
}
