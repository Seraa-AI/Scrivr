import { useEffect, useState } from "react";
import type { Editor } from "@scrivr/core";
import { createSuggestionPopover, getAiToolkit } from "@scrivr/plugins";
import type { SuggestionGroupInfo } from "@scrivr/plugins";
import { useFloatingPosition } from "./useFloatingPosition";

export interface UseAiSuggestionPopoverOptions {
  mode?: "direct" | "tracked" | undefined;
}

export function useAiSuggestionPopover(
  editor: Editor | null,
  options: UseAiSuggestionPopoverOptions = {},
) {
  const mode = options.mode ?? "direct";
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<SuggestionGroupInfo | null>(null);
  const { ref, position } = useFloatingPosition<HTMLDivElement>(
    rect,
    [info],
  );

  useEffect(() => {
    if (!editor) return;
    return createSuggestionPopover(editor, {
      onShow: (r, i) => {
        setRect(r);
        setInfo(i);
      },
      onMove: (r, i) => {
        setRect(r);
        setInfo(i);
      },
      onHide: () => {
        setRect(null);
        setInfo(null);
      },
    });
  }, [editor]);

  function dismiss() {
    setRect(null);
    setInfo(null);
  }

  function accept() {
    if (!editor || !info) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.apply({ groupId: info.groupId, mode });
    dismiss();
  }

  function acceptAll() {
    if (!editor) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.apply({ mode });
    dismiss();
  }

  function reject() {
    if (!editor || !info) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.reject({ groupId: info.groupId });
    dismiss();
  }

  function rejectAll() {
    if (!editor) return;
    const ai = getAiToolkit(editor);
    ai?.suggestions?.reject();
    dismiss();
  }

  return {
    visible: !!rect && !!info,
    rect,
    info,
    position,
    rootRef: ref,
    isReplacement: !!(info?.replacedText && info.insertedText),
    isPureInsert: !info?.replacedText && !!info?.insertedText,
    accept,
    acceptAll,
    reject,
    rejectAll,
    dismiss,
  };
}
