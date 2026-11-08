/**
 * TrackChangesPanel — sidebar panel listing all pending tracked changes.
 *
 * Shows text insertions/deletions (grouped as "Replacement" when paired),
 * inline format changes (bold, italic, color…), block attribute changes
 * (alignment, heading level…), and structural changes (wrap, node insert/delete).
 *
 * Each row has Accept / Reject buttons. Header has Accept All / Reject All.
 */

import type { IBaseEditor } from "@scrivr/core";
import { CHANGE_OPERATION, changePreviewText } from "@scrivr/plugins";
import type {
  TrackedChange,
  MarkChange,
  NodeAttrChange,
} from "@scrivr/plugins";
import { cx } from "../utils/classNames";
import { shortName } from "../utils/authorName";
import { decisionLabel, getChangeMeta, MARK_LABELS, previewVerb } from "../utils/changeMeta";
import type { ChangeMeta } from "../utils/changeMeta";
import { useTrackChangesPanel } from "../hooks/useTrackChangesPanel";
import type { TrackChangesDisplayItem } from "../hooks/useTrackChangesPanel";
import { useReviewAction } from "../hooks/useReviewAction";
import { ReviewRefusalNotice } from "./ReviewRefusalNotice";

function truncate(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

const ATTR_LABELS: Record<string, string> = {
  align: "Alignment",
  level: "Heading level",
  fontFamily: "Font",
  fontSize: "Font size",
  indent: "Indent",
};

/** Describe what changed in a NodeAttrChange. */
function describeAttrChange(change: NodeAttrChange): string {
  const old = change.oldAttrs
  const next = change.newAttrs
  const parts: string[] = [];
  const allKeys = new Set([...Object.keys(old), ...Object.keys(next)]);

  for (const key of allKeys) {
    if (key === "nodeId" || key === "dataTracked") continue;
    if (old[key] !== next[key]) {
      const label = ATTR_LABELS[key] ?? key;
      const from = old[key] == null ? "none" : String(old[key]);
      const to = next[key] == null ? "none" : String(next[key]);
      parts.push(`${label}: ${from} → ${to}`);
    }
  }

  return parts.join(" · ");
}

/** Describe a MarkChange for display. */
function describeMarkChange(change: MarkChange): string {
  const text = change.node.text;
  const colorAttr: unknown = change.mark.attrs.color;
  if (colorAttr && typeof colorAttr === "string") {
    return text ? `"${truncate(text)}" → ${colorAttr}` : colorAttr;
  }
  return text ? `"${truncate(text)}"` : "";
}


export interface TrackChangesPanelProps {
  editor: IBaseEditor | null;
  className?: string | undefined;
  itemClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  emptyClassName?: string | undefined;
}

export function TrackChangesPanel({
  editor,
  className,
  itemClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
  emptyClassName,
}: TrackChangesPanelProps) {
  const panel = useTrackChangesPanel(editor);

  return (
    <aside
      className={cx("scrivr-track-panel", className)}
      style={{
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 44,
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          className={cx("scrivr-menu-title", titleClassName)}
          data-part="title"
          style={{
          }}
        >
          Track Changes
        </span>
        {panel.items.length > 0 && (
          <span
            className={cx("scrivr-menu-icon", iconClassName)}
            data-part="icon"
            style={{
            }}
          >
            {panel.items.length}
          </span>
        )}

        {!panel.isEmpty && panel.review.available && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
            <button className={cx("scrivr-menu-item", itemClassName)} onClick={panel.rejectAll} style={actionBtn}>
              Reject all
            </button>
            <button className={cx("scrivr-menu-item", itemClassName)} onClick={panel.acceptAll} style={actionBtn}>
              Accept all
            </button>
          </div>
        )}
      </div>

      {/* Whatever stopped the last header decision belongs with the buttons
          that made it, not on a card nobody clicked. */}
      <ReviewRefusalNotice action={panel.review} />

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: panel.isEmpty ? 0 : "6px 0",
        }}
      >
        {panel.isEmpty ? (
          <div
            className={cx("scrivr-menu-empty", emptyClassName)}
            data-empty
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 8,
            }}
          >
            <span className={cx("scrivr-menu-icon", iconClassName)} data-part="icon">Done</span>
            <span
              className={cx("scrivr-menu-description", descriptionClassName)}
              data-part="description"
              style={{
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              No pending changes
            </span>
          </div>
        ) : (
          panel.items.map((item, i) =>
            item.kind === "replacement" ? (
              <ReplacementRow key={item.ids.join(":")} item={item} editor={editor} />
            ) : (
              <SingleRow key={item.change.id} change={item.change} pieces={item.pieces} pending={panel.changes} editor={editor} />
            ),
          )
        )}
      </div>
    </aside>
  );
}

function ReplacementRow({
  item,
  editor,
}: {
  item: Extract<TrackChangesDisplayItem, { kind: "replacement" }>;
  editor: IBaseEditor | null;
}) {
  const { deletedText, insertedText, ids, authorID } = item;
  const review = useReviewAction(editor);

  return (
    <ChangeRow
      meta={{
        icon: "↔",
        label: "Replacement",
      }}
      authorID={authorID}
      onAccept={() => review.decide("accepted", ids)}
      onReject={() => review.decide("rejected", ids)}
      refusal={<ReviewRefusalNotice action={review} />}
    >
      <div style={previewLine}>
        <span style={prefixLabel}>Removing</span>
        <em style={{ fontStyle: "italic" }}>"{truncate(deletedText)}"</em>
      </div>
      <div style={previewLine}>
        <span style={prefixLabel}>Adding</span>
        <em style={{ fontStyle: "italic" }}>"{truncate(insertedText)}"</em>
      </div>
    </ChangeRow>
  );
}

function SingleRow({
  change,
  pieces,
  pending,
  editor,
}: {
  change: TrackedChange;
  pieces: TrackedChange[];
  /** Every pending change, which a move's preview reads its moved copy from. */
  pending: TrackedChange[];
  editor: IBaseEditor | null;
}) {
  const meta = getChangeMeta(change);
  const authorID = change.dataTracked.authorID;
  const review = useReviewAction(editor);

  function accept() {
    review.decide("accepted", [change.id]);
  }
  function reject() {
    review.decide("rejected", [change.id]);
  }

  let preview: React.ReactNode = null;

  if (change.type === "text-change") {
    // A move is shown once, by where it went, not as both of its halves.
    const moving = !!change.dataTracked.moveId;
    const verb = previewVerb(change.dataTracked.operation, moving);
    const shown = moving ? pieces.filter(piece => piece.dataTracked.operation === CHANGE_OPERATION.insert) : pieces;
    preview = (
      <div
        style={previewLine}
      >
        <span style={prefixLabel}>{verb}</span>
        <em>"{truncate(shown.map(piece => (piece.type === "text-change" ? piece.text : "")).join(" … "))}"</em>
      </div>
    );
  } else if (change.type === "mark-change") {
    const desc = describeMarkChange(change);
    if (desc) {
      preview = <div style={previewLine}>{desc}</div>;
    }
  } else if (change.type === "node-attr-change") {
    const desc = describeAttrChange(change);
    preview = <div style={previewLine}>{desc}</div>;
  } else if (change.type === "wrap-change") {
    const wc = change
    preview = (
      <div style={previewLine}>
        Wrapped in <em>{wc.wrapperNode}</em>
      </div>
    );
  } else if (change.type === "node-change") {
    const verb = previewVerb(change.dataTracked.operation, !!change.dataTracked.moveNodeId);
    const doc = editor?.getState().doc;
    const text = doc ? changePreviewText(doc, change, pending) : "";
    preview = (
      <div style={previewLine}>
        {verb ? <span style={prefixLabel}>{decisionLabel(verb, meta)}</span> : null}
        {text ? <em>"{truncate(text)}"</em> : change.node.type.name}
      </div>
    );
  }

  return (
    <ChangeRow
      meta={meta}
      authorID={authorID}
      onAccept={accept}
      onReject={reject}
      refusal={<ReviewRefusalNotice action={review} />}
    >
      {preview}
    </ChangeRow>
  );
}

function ChangeRow({
  meta,
  authorID,
  onAccept,
  onReject,
  children,
  refusal,
}: {
  meta: ChangeMeta;
  authorID: string;
  onAccept: () => void;
  onReject: () => void;
  children: React.ReactNode;
  /** Shown under the row: why this card's last click did not complete. */
  refusal?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      {/* Top row: badge + author + buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          {meta.icon} {meta.label}
        </span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shortName(authorID)}
        </span>
        <button
          onClick={onReject}
          title={decisionLabel("Reject", meta)}
          style={iconBtn}
        >
          ✗
        </button>
        <button
          onClick={onAccept}
          title={decisionLabel("Accept", meta)}
          style={iconBtn}
        >
          ✓
        </button>
      </div>

      {/* Preview */}
      {children}

      {refusal}
    </div>
  );
}

const previewLine: React.CSSProperties = {
  lineHeight: 1.5,
  wordBreak: "break-word",
  display: "flex",
  gap: 5,
  alignItems: "baseline",
};

const prefixLabel: React.CSSProperties = {
  textTransform: "uppercase",
  flexShrink: 0,
};

const iconBtn: React.CSSProperties = {
  border: "none",
  width: 22,
  height: 22,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  padding: 0,
};

const actionBtn: React.CSSProperties = {
  border: "none",
  cursor: "pointer",
  flexShrink: 0,
};
