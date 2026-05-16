import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@scrivr/core";
import { createSuggestionPopover, getAiToolkit } from "@scrivr/plugins";
import type { SuggestionGroupInfo } from "@scrivr/plugins";
import { cx } from "./classNames";
import { useFloatingPosition } from "./useFloatingPosition";

export interface AiSuggestionPopoverProps {
  editor: Editor | null;
  /**
   * "direct"  — accepted changes are applied as plain document edits.
   * "tracked" — accepted changes enter the track-changes flow as pending marks.
   * Default: "direct".
   */
  mode?: "direct" | "tracked";
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}

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

/**
 * AiSuggestionPopover — React component that shows accept/reject controls
 * when the cursor is inside an AI suggestion group.
 *
 * @example
 * <AiSuggestionPopover editor={editor} mode="tracked" />
 */
export function AiSuggestionPopover({
  editor,
  mode = "direct",
  className,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
}: AiSuggestionPopoverProps) {
  const popover = useAiSuggestionPopover(editor, { mode });

  if (!popover.visible || !popover.info) return null;

  return createPortal(
    <div
      ref={popover.rootRef}
      className={cx("scrivr-menu scrivr-ai-popover", className)}
      onMouseDown={(e) => e.preventDefault()}
      data-disabled={popover.info.isStale ? "" : undefined}
      style={{
        position: "fixed",
        left: popover.position?.x ?? 0,
        top: popover.position?.y ?? 0,
        zIndex: "var(--scrivr-react-popover-z, 60)",
        visibility: popover.position ? "visible" : "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 240,
        maxWidth: 420,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className={cx("scrivr-menu-icon", iconClassName)} data-part="icon" style={badge}>
          AI
        </span>
        <span className={cx("scrivr-menu-title", titleClassName)} data-part="title">
          Suggestion
        </span>
        {popover.info.isStale && (
          <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
            Document changed
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button className={cx("scrivr-menu-item", itemClassName)} onClick={popover.accept} style={btnStyle}>
          Accept
        </button>
        <button className={cx("scrivr-menu-item", itemClassName)} onClick={popover.reject} style={btnStyle}>
          Reject
        </button>
      </div>

      {/* Preview */}
      {popover.isReplacement && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={previewStyle}>
            Removing: <em>"{popover.info.replacedText}"</em>
          </div>
          <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={previewStyle}>
            Adding: <em>"{popover.info.insertedText}"</em>
          </div>
        </div>
      )}
      {popover.isPureInsert && (
        <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={previewStyle}>
          Adding: <em>"{popover.info.insertedText}"</em>
        </div>
      )}
      {!popover.isReplacement && !popover.isPureInsert && popover.info.replacedText && (
        <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={previewStyle}>
          Removing: <em>"{popover.info.replacedText}"</em>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 6,
          paddingTop: 2,
        }}
      >
        <button className={cx("scrivr-menu-item", itemClassName)} onClick={popover.acceptAll} style={btnStyle}>
          Accept All
        </button>
        <button className={cx("scrivr-menu-item", itemClassName)} onClick={popover.rejectAll} style={btnStyle}>
          Reject All
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const badge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  flexShrink: 0,
} as const;

const previewStyle = {
  lineHeight: 1.4,
  wordBreak: "break-word" as const,
  maxHeight: 60,
  overflowY: "auto" as const,
};

const btnStyle = {
  border: "none",
  cursor: "pointer",
  flexShrink: 0,
} as const;
