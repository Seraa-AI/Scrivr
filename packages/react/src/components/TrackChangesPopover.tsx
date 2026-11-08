import { createPortal } from "react-dom";
import type { Editor, IBaseEditor } from "@scrivr/core";
import { CHANGE_OPERATION, trackChangesPluginKey } from "@scrivr/plugins";
import type { ChangePopoverInfo, ReviewDecision } from "@scrivr/plugins";
import { cx } from "../utils/classNames";
import { shortName } from "../utils/authorName";
import { useTrackChangesPopover } from "../hooks/useTrackChangesPopover";
import { useReviewAction } from "../hooks/useReviewAction";
import { ReviewRefusalNotice } from "./ReviewRefusalNotice";
import { changeName, getChangeMeta, type ChangeMeta, type NamedChangeType } from "../utils/changeMeta";

export interface TrackChangesPopoverProps {
  editor: Editor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
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
      data-scrivr-popover="track-changes-popover"
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

/** The kind of change each popover kind is named as. */
const KIND_TYPE: Record<ChangePopoverInfo["changeKind"], NamedChangeType> = {
  text: "text-change",
  mark: "text-change",
  "node-attr": "node-attr-change",
  node: "node-change",
  wrap: "wrap-change",
  reference: "reference-change",
};

/** What text a change adds or removes; other changes show it as it is. */
const VERB: Partial<Record<CHANGE_OPERATION, string>> = {
  [CHANGE_OPERATION.insert]: "Adding: ",
  [CHANGE_OPERATION.delete]: "Removing: ",
};

const REPLACEMENT: ChangeMeta = { icon: "↔", label: "Replacement" };

/** Named as the panel names it, from the change itself while it is still in the document. */
function badgeMeta(info: ChangePopoverInfo, editor: IBaseEditor | null): ChangeMeta {
  if (info.replacedText && info.insertedText) return REPLACEMENT;
  const change = editor && trackChangesPluginKey.getState(editor.getState())?.changeSet.changes
    .find(candidate => candidate.id === info.id);
  return change ? getChangeMeta(change) : changeName(KIND_TYPE[info.changeKind], info.operation, !!info.moveId);
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
  editor: IBaseEditor | null;
  onClose: () => void;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}) {
  const bm = badgeMeta(info, editor);
  const author = shortName(info.authorID);
  const ids = info.groupIds.length > 0 ? info.groupIds : [info.id];
  const review = useReviewAction(editor);

  // The popover stays open on a refusal: closing it would take the explanation
  // away with it, leaving a click that silently did nothing.
  const decide = (decision: ReviewDecision, forIds: string[]) => {
    if (review.decide(decision, forIds).status === "applied") onClose();
  };

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
        {info.moveId ? "Moving: " : VERB[info.operation] ?? ""}
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
          onClick={() => decide("accepted", ids)}
          style={btnStyle}
        >
          Accept
        </button>
        <button
          className={cx("scrivr-menu-item", itemClassName)}
          onClick={() => decide("rejected", ids)}
          style={btnStyle}
        >
          Reject
        </button>
      </div>
      {preview}
      <ReviewRefusalNotice action={review} />
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
  editor: IBaseEditor | null;
  onClose: () => void;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
}) {
  const changes =
    info.conflictChanges.length > 0 ? info.conflictChanges : [info];

  const review = useReviewAction(editor);

  function acceptOne(id: string) {
    const others = changes.filter((c) => c.id !== id).map((c) => c.id);
    if (review.resolveConflict(id, others).status === "applied") onClose();
  }

  function rejectAll() {
    if (review.decide("rejected", changes.map((c) => c.id)).status === "applied") onClose();
  }

  function rejectOne(id: string) {
    if (review.decide("rejected", [id]).status === "applied") onClose();
  }

  return (
    <>
      <ReviewRefusalNotice action={review} />
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
                {badgeMeta(c, editor).icon} {badgeMeta(c, editor).label}
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
                onClick={() => rejectOne(c.id)}
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

const badge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  flexShrink: 0,
};

const textPreview: React.CSSProperties = {
  lineHeight: 1.4,
  wordBreak: "break-word",
  maxHeight: 60,
  overflowY: "auto",
};

const btnStyle: React.CSSProperties = {
  border: "none",
  cursor: "pointer",
  flexShrink: 0,
};
