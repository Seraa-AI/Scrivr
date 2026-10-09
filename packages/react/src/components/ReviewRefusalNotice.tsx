/**
 * Why a review click did not complete, shown on the surface that was clicked.
 *
 * Each reason gets its own words, and only dependent work is offered a remedy —
 * it is the only one deciding more can resolve.
 */

import type { ReviewAction, ReviewRefusalState } from "../hooks/useReviewAction";
import type { TrackedChange } from "@scrivr/plugins";
import { cx } from "../utils/classNames";
import { shortName } from "../utils/authorName";

export interface ReviewRefusalNoticeProps {
  action: ReviewAction;
  className?: string | undefined;
  itemClassName?: string | undefined;
}

const wrap: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--scrivr-react-notice-border, #e0c08a)",
  background: "var(--scrivr-react-notice-surface, #fdf6e7)",
  color: "var(--scrivr-react-text, #111827)",
  fontSize: 12,
  lineHeight: 1.45,
};

const actions: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
};

const button: React.CSSProperties = {
  font: "inherit",
  padding: "3px 8px",
  borderRadius: 4,
  border: "1px solid var(--scrivr-react-border, #e2e8f0)",
  background: "var(--scrivr-react-surface, #ffffff)",
  color: "inherit",
  cursor: "pointer",
};

const listStyle: React.CSSProperties = { margin: "8px 0 0", paddingLeft: 18 };

const imperative = (decision: ReviewRefusalState["decision"]) =>
  decision === "accepted" ? "Accept" : "Reject";

const author = (change: TrackedChange) => shortName(change.dataTracked.authorID);

function DependentList({ dependents }: { dependents: TrackedChange[] }) {
  return (
    <ul style={listStyle}>
      {dependents.map(change => (
        <li key={change.id}>
          {author(change)} — {change.type.replace(/-/g, " ")}
        </li>
      ))}
    </ul>
  );
}

export function ReviewRefusalNotice({
  action,
  className,
  itemClassName,
}: ReviewRefusalNoticeProps) {
  const state = action.refusal;
  if (!state) return null;
  const { refusal, decision, dependents, stage, grew } = state;

  const Button = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      className={cx("scrivr-menu-item", itemClassName)}
      style={button}
      onClick={onClick}
    >
      {children}
    </button>
  );

  const Frame = ({ children, alert }: { children: React.ReactNode; alert?: boolean }) => (
    <div className={className} style={wrap} role={alert ? "alert" : "status"} data-part="notice">
      {children}
    </div>
  );

  if (refusal.reason !== "dependent-changes") {
    const message =
      refusal.reason === "not-permitted"
        ? "You do not have permission to accept or reject changes in this document."
        : refusal.reason === "missing-changes"
          ? "This change is no longer pending — it may already have been reviewed."
          : "This decision could not be completed, so nothing was changed. Try again, and report it if it keeps happening.";
    return (
      <Frame alert={refusal.reason === "invalid-result"}>
        {message}
        <div style={actions}>
          <Button onClick={action.dismiss}>Dismiss</Button>
        </div>
      </Frame>
    );
  }

  const authors = [...new Set(dependents.map(author))];
  const whose =
    authors.length === 1 ? `${authors[0]}'s pending changes` : "other pending changes";
  const count = `${dependents.length} dependent change${dependents.length === 1 ? "" : "s"}`;

  if (stage === "confirm") {
    return (
      <Frame>
        {grew
          ? `More work now depends on this. ${imperative(decision)} all of the following?`
          : `${imperative(decision)} this and ${count}?`}
        <DependentList dependents={dependents} />
        <div style={actions}>
          <Button onClick={action.confirm}>
            {imperative(decision)} all {dependents.length + 1}
          </Button>
          <Button onClick={action.dismiss}>Cancel</Button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      This contains {whose}.{" "}
      {decision === "accepted"
        ? "Accepting it would also accept them."
        : "Rejecting it would also remove them."}
      {stage === "listed" && <DependentList dependents={dependents} />}
      <div style={actions}>
        {stage === "explain" && (
          <Button onClick={action.listDependents}>Review dependent changes</Button>
        )}
        <Button onClick={action.requestConfirm}>
          {imperative(decision)} this and {count}…
        </Button>
        <Button onClick={action.dismiss}>Cancel</Button>
      </div>
    </Frame>
  );
}
