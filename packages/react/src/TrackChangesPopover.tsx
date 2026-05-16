import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Placement } from "@floating-ui/dom";
import type { Editor } from "@scrivr/core";
import {
  createChangePopover,
  CHANGE_OPERATION,
  CHANGE_STATUS,
} from "@scrivr/plugins";
import type { ChangePopoverInfo } from "@scrivr/plugins";
import { cx } from "./classNames";
import { useFloatingPosition } from "./useFloatingPosition";

const TRACK_POPOVER_FALLBACK_PLACEMENTS: Placement[] = ["top-start"];

export interface TrackChangesPopoverProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}

export function useTrackChangesPopover(editor: Editor | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<ChangePopoverInfo | null>(null);
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect, [info], {
    fallbackPlacements: TRACK_POPOVER_FALLBACK_PLACEMENTS,
  });

  useEffect(() => {
    if (!editor) return;
    return createChangePopover(editor, {
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

  return {
    visible: !!rect && !!info,
    rect,
    info,
    position,
    rootRef: ref,
    dismiss,
  };
}

export function TrackChangesPopover({
  editor,
  className,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
}: TrackChangesPopoverProps) {
  const popover = useTrackChangesPopover(editor);

  if (!popover.visible || !popover.info) return null;

  return createPortal(
    <div
      ref={popover.rootRef}
      className={cx("scrivr-menu scrivr-track-popover", className)}
      onMouseDown={(e) => e.preventDefault()}
      data-active={popover.info.isConflict ? "" : undefined}
      style={{
        position: "fixed",
        left: popover.position?.x ?? 0,
        top: popover.position?.y ?? 0,
        zIndex: "var(--scrivr-react-popover-z, 60)",
        visibility: popover.position ? "visible" : "hidden",
        display: "flex",
        flexDirection: "column",
        gap: popover.info.isConflict ? 10 : 8,
        minWidth: popover.info.isConflict ? 320 : 220,
        maxWidth: 420,
      }}
    >
      {popover.info.isConflict ? (
        <ConflictPopover
          info={popover.info}
          editor={editor}
          onClose={popover.dismiss}
          itemClassName={itemClassName}
          iconClassName={iconClassName}
          titleClassName={titleClassName}
          descriptionClassName={descriptionClassName}
        />
      ) : (
        <SingleChangePopover
          info={popover.info}
          editor={editor}
          onClose={popover.dismiss}
          itemClassName={itemClassName}
          iconClassName={iconClassName}
          titleClassName={titleClassName}
          descriptionClassName={descriptionClassName}
        />
      )}
    </div>,
    document.body,
  );
}

// ── Single-change popover ──────────────────────────────────────────────────────

const MARK_ICONS: Record<string, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strikethrough: "S",
  highlight: "H",
  color: "●",
  fontSize: "Aa",
  fontFamily: "Ff",
  link: "↗",
};

const MARK_LABELS: Record<string, string> = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strikethrough: "Strikethrough",
  highlight: "Highlight",
  color: "Color",
  fontSize: "Font size",
  fontFamily: "Font family",
  link: "Link",
};

/** Derive badge label and icon from ChangePopoverInfo. */
function badgeMeta(info: ChangePopoverInfo): {
  icon: string;
  label: string;
} {
  const isDelete = info.operation === CHANGE_OPERATION.delete;

  if (info.replacedText && info.insertedText) {
    return { icon: "↔", label: "Replacement" };
  }
  if (info.changeKind === "mark" && info.markName) {
    const name = MARK_LABELS[info.markName] ?? info.markName;
    const icon = MARK_ICONS[info.markName] ?? "M";
    const label = isDelete ? `${name} removed` : `${name} added`;
    return { icon, label };
  }
  if (info.changeKind === "node-attr") {
    return {
      icon: "≡",
      label: "Style changed",
    };
  }
  if (info.changeKind === "node") {
    return isDelete
      ? { icon: "□−", label: "Block removed" }
      : { icon: "□+", label: "Block added" };
  }
  if (info.operation === CHANGE_OPERATION.move) {
    return { icon: "⇄", label: "Moved" };
  }
  return isDelete
    ? { icon: "−", label: "Deletion" }
    : { icon: "+", label: "Insertion" };
}

function SingleChangePopover({
  info,
  editor,
  onClose,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
}: {
  info: ChangePopoverInfo;
  editor: Editor | null;
  onClose: () => void;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}) {
  const bm = badgeMeta(info);
  const author = shortName(info.authorID);
  const isDelete = info.operation === CHANGE_OPERATION.delete;
  const ids = info.groupIds.length > 0 ? info.groupIds : [info.id];

  // ── Preview content ────────────────────────────────────────────────────────
  let preview: React.ReactNode = null;

  if (info.replacedText && info.insertedText) {
    preview = (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={textPreview}>
          Removing: <em>"{info.replacedText}"</em>
        </div>
        <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={textPreview}>
          Adding: <em>"{info.insertedText}"</em>
        </div>
      </div>
    );
  } else if (info.changeKind === "node-attr") {
    // text is already the attr diff string ("Heading level: 1 → 2")
    if (info.text) {
      preview = (
        <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={textPreview}>{info.text}</div>
      );
    }
  } else if (info.changeKind === "mark") {
    // Show the affected text without "Adding:" prefix — the badge already says what mark changed.
    if (info.text) {
      preview = (
        <div className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={textPreview}>
          <em>"{info.text}"</em>
        </div>
      );
    }
  } else if (info.text) {
    preview = (
      <div
        className={cx("scrivr-menu-description", descriptionClassName)}
        data-part="description"
        style={textPreview}
      >
        {isDelete ? "Removing: " : "Adding: "}
        <em>"{info.text}"</em>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className={cx("scrivr-menu-icon", iconClassName)} data-part="icon" style={badge}>
          {bm.icon}
        </span>
        <span className={cx("scrivr-menu-title", titleClassName)} data-part="title">
          {bm.label}
        </span>
        <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description" style={{ flex: 1 }}>
          {author}
        </span>
        <button
          className={cx("scrivr-menu-item", itemClassName)}
          onClick={() => {
            editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, ids);
            onClose();
          }}
          style={btnStyle}
        >
          Accept
        </button>
        <button
          className={cx("scrivr-menu-item", itemClassName)}
          onClick={() => {
            editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, ids);
            onClose();
          }}
          style={btnStyle}
        >
          Reject
        </button>
      </div>
      {preview}
    </>
  );
}

// ── Conflict popover ───────────────────────────────────────────────────────────

function ConflictPopover({
  info,
  editor,
  onClose,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
}: {
  info: ChangePopoverInfo;
  editor: Editor | null;
  onClose: () => void;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}) {
  const changes =
    info.conflictChanges.length > 0 ? info.conflictChanges : [info];

  function acceptOne(id: string) {
    const others = changes.filter((c) => c.id !== id).map((c) => c.id);
    editor?.commands.setChangeStatuses?.(CHANGE_STATUS.accepted, [id]);
    if (others.length > 0)
      editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, others);
    onClose();
  }

  function rejectAll() {
    editor?.commands.setChangeStatuses?.(
      CHANGE_STATUS.rejected,
      changes.map((c) => c.id),
    );
    onClose();
  }

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className={cx("scrivr-menu-icon", iconClassName)} data-part="icon" style={badge}>
          Conflict
        </span>
        <span className={cx("scrivr-menu-title", titleClassName)} data-part="title">
          {changes.length} conflicting changes — choose how to resolve
        </span>
      </div>

      {/* Per-author rows */}
      {changes.map((c) => {
        const isDelete = c.operation === CHANGE_OPERATION.delete;
        const author = shortName(c.authorID);
        const actionLabel = isDelete ? "wants to remove" : "wants to add";

        return (
          <div
            key={c.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {/* Author + action label */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                className={cx("scrivr-menu-icon", iconClassName)}
                data-part="icon"
                style={badge}
              >
                {badgeMeta(c).icon} {badgeMeta(c).label}
              </span>
              <span className={cx("scrivr-menu-title", titleClassName)} data-part="title">
                {author}
              </span>
              <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
                {actionLabel}
              </span>
            </div>

            {/* Text preview */}
            {c.text ? (
              <div
                className={cx("scrivr-menu-description", descriptionClassName)}
                data-part="description"
                style={textPreview}
              >
                "{c.text}"
              </div>
            ) : (
              <div
                className={cx("scrivr-menu-description", descriptionClassName)}
                data-part="description"
              >
                {isDelete ? "(paragraph / node deletion)" : "(new content)"}
              </div>
            )}

            {/* Row actions */}
            <div
              style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
            >
              <button
                onClick={() => acceptOne(c.id)}
                className={cx("scrivr-menu-item", itemClassName)}
                style={btnStyle}
                title={`Accept ${author}'s ${isDelete ? "deletion" : "insertion"}, reject others`}
              >
                {isDelete ? "Keep deletion" : "Keep insertion"}
              </button>
              <button
                onClick={() => {
                  editor?.commands.setChangeStatuses?.(CHANGE_STATUS.rejected, [
                    c.id,
                  ]);
                  onClose();
                }}
                className={cx("scrivr-menu-item", itemClassName)}
                style={btnStyle}
                title={`Reject only ${author}'s change`}
              >
                Ignore
              </button>
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 2,
        }}
      >
        <span className={cx("scrivr-menu-description", descriptionClassName)} data-part="description">
          Or reject all changes in this range
        </span>
        <button className={cx("scrivr-menu-item", itemClassName)} onClick={rejectAll} style={btnStyle}>
          Reject All
        </button>
      </div>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Display name: strip "user:" prefix if present, cap length. */
function shortName(authorID: string): string {
  const name = authorID.split(":").pop() ?? authorID;
  return name.length > 20 ? name.slice(0, 20) + "…" : name;
}

const badge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  flexShrink: 0,
} as const;

const textPreview = {
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
