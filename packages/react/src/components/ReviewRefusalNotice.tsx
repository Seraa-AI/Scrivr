/**
 * Why a review click did not complete, shown on the surface that was clicked.
 *
 * Each reason gets its own words, and only dependent work is offered a remedy —
 * it is the only one deciding more can resolve.
 */

import type { ReviewAction, ReviewRefusalState } from "../hooks/useReviewAction";
import type { ReviewDecisions, ReviewRefusal, TrackedChange } from "@scrivr/plugins";
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

const explanation: Record<Exclude<ReviewRefusal["reason"], "dependent-changes">, string> = {
  "not-permitted": "You do not have permission to accept or reject changes in this document.",
  "read-only": "This document is read-only, so its changes cannot be accepted or rejected.",
  "missing-changes": "This change is no longer pending — it may already have been reviewed.",
  "contradictory-decisions":
    "Some of these changes are parts of one change, so they cannot be accepted and rejected separately.",
  "invalid-result":
    "This decision could not be completed, so nothing was changed. Try again, and report it if it keeps happening.",
};

/** How to name the compound decision: one direction, or a resolution of both. */
const imperative = ({ accepted, rejected }: ReviewDecisions) =>
  !rejected.length ? "Accept" : !accepted.length ? "Reject" : "Resolve";

const consequence = ({ accepted, rejected }: ReviewDecisions) =>
  !rejected.length
    ? "Accepting it would also accept them."
    : !accepted.length
      ? "Rejecting it would also remove them."
      : "Resolving it would also decide them.";

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
  const { refusal, compound, dependents, stage, grew } = state;

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
    return (
      <Frame alert={refusal.reason === "invalid-result"}>
        {explanation[refusal.reason]}
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
          ? `More work now depends on this. ${imperative(compound)} all of the following?`
          : `${imperative(compound)} this and ${count}?`}
        <DependentList dependents={dependents} />
        <div style={actions}>
          <Button onClick={action.confirm}>
            {imperative(compound)} all {compound.accepted.length + compound.rejected.length}
          </Button>
          <Button onClick={action.dismiss}>Cancel</Button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      This contains {whose}.{" "}
      {consequence(compound)}
      {stage === "listed" && <DependentList dependents={dependents} />}
      <div style={actions}>
        {stage === "explain" && (
          <Button onClick={action.listDependents}>Review dependent changes</Button>
        )}
        <Button onClick={action.requestConfirm}>
          {imperative(compound)} this and {count}…
        </Button>
        <Button onClick={action.dismiss}>Cancel</Button>
      </div>
    </Frame>
  );
}
