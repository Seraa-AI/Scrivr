/**
 * Why a review click did not complete, shown on the card that was clicked.
 *
 * Each reason gets its own words. Only dependent work can be resolved by
 * deciding more, so only that reason offers it — named, listed, and behind a
 * confirmation, never as a default remedy for every refusal.
 */

import type { ReviewAction, ReviewRefusalState } from "../hooks/useReviewAction";
import type { TrackedChange } from "@scrivr/plugins";

const wrap: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--scrivr-notice-border, #e0c08a)",
  background: "var(--scrivr-notice-bg, #fdf6e7)",
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
  border: "1px solid var(--scrivr-border, #c9c9c9)",
  background: "var(--scrivr-surface, #fff)",
  cursor: "pointer",
};

const list: React.CSSProperties = { margin: "8px 0 0", paddingLeft: 18 };

const imperative = (decision: ReviewRefusalState["decision"]) =>
  decision === "accepted" ? "Accept" : "Reject";

const author = (change: TrackedChange) => change.dataTracked.authorID ?? "another author";

const describe = (change: TrackedChange) =>
  `${author(change)} — ${change.type.replace(/-/g, " ")}`;

function Notice({
  children,
  onDismiss,
  alert,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  alert?: boolean;
}) {
  return (
    <div style={wrap} role={alert ? "alert" : "status"}>
      {children}
      <div style={actions}>
        <button type="button" style={button} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function ReviewRefusal({ action }: { action: ReviewAction }) {
  const state = action.refusal;
  if (!state) return null;
  const { refusal, decision, dependents, stage, listed, grew } = state;

  if (refusal.reason === "not-permitted") {
    return (
      <Notice onDismiss={action.dismiss}>
        You do not have permission to accept or reject changes in this document.
      </Notice>
    );
  }

  if (refusal.reason === "missing-changes") {
    return (
      <Notice onDismiss={action.dismiss}>
        This change is no longer pending — it may already have been reviewed.
      </Notice>
    );
  }

  if (refusal.reason === "invalid-result") {
    return (
      <Notice onDismiss={action.dismiss} alert>
        This decision could not be completed, so nothing was changed. Try again,
        and report it if it keeps happening.
      </Notice>
    );
  }

  const authors = [...new Set(dependents.map(author))];
  const whose =
    authors.length === 1 ? `${authors[0]}'s pending changes` : "other pending changes";
  const count = `${dependents.length} dependent change${dependents.length === 1 ? "" : "s"}`;

  if (stage === "confirm") {
    return (
      <div style={wrap} role="status">
        {grew
          ? `More work now depends on this. ${imperative(decision)} all of the following?`
          : `${imperative(decision)} this and ${count}?`}
        <ul style={list}>
          {dependents.map(change => (
            <li key={change.id}>{describe(change)}</li>
          ))}
        </ul>
        <div style={actions}>
          <button type="button" style={button} onClick={action.confirm}>
            {imperative(decision)} all {dependents.length + 1}
          </button>
          <button type="button" style={button} onClick={action.dismiss}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap} role="status">
      This contains {whose}.{" "}
      {decision === "accepted"
        ? "Accepting it would also accept them."
        : "Rejecting it would also remove them."}
      {listed && (
        <ul style={list}>
          {dependents.map(change => (
            <li key={change.id}>{describe(change)}</li>
          ))}
        </ul>
      )}
      <div style={actions}>
        {!listed && (
          <button type="button" style={button} onClick={action.listDependents}>
            Review dependent changes
          </button>
        )}
        <button type="button" style={button} onClick={action.requestConfirm}>
          {imperative(decision)} this and {count}…
        </button>
        <button type="button" style={button} onClick={action.dismiss}>
          Cancel
        </button>
      </div>
    </div>
  );
}
