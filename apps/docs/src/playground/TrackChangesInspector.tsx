/**
 * What track changes last decided, where a person can see it.
 *
 * Tracking and review both report structured outcomes on plugin state, and a
 * refusal is the one a host has to act on — but nothing in the document shows
 * it. Without a readout, testing "was this gesture recorded?" or "why did that
 * click do nothing?" means stepping through a debugger.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@scrivr/core";
import { trackChangesPluginKey } from "@scrivr/plugins";
import type { ReviewOutcome, TrackingResult } from "@scrivr/plugins";

type Snapshot = {
  tracking: TrackingResult | null;
  review: ReviewOutcome | null;
  pending: number;
  authors: string[];
};

const empty: Snapshot = { tracking: null, review: null, pending: 0, authors: [] };

function read(editor: Editor | null): Snapshot {
  if (!editor) return empty;
  const state = trackChangesPluginKey.getState(editor.getState());
  if (!state) return empty;
  const pending = state.changeSet.pending;
  return {
    tracking: state.lastTracking,
    review: state.lastReview,
    pending: pending.length,
    authors: [...new Set(pending.map(change => change.dataTracked.authorID))].sort(),
  };
}

const describeTracking = (result: TrackingResult | null) => {
  if (!result) return "nothing tracked yet";
  if (result.status === "ready") {
    return `tracked · ${result.steps} step${result.steps === 1 ? "" : "s"} · ${result.elapsedMs}ms`;
  }
  const detail =
    result.failure === "unsupported-step"
      ? `unsupported step: ${result.stepType}`
      : result.failure;
  return `REFUSED · ${detail} · ${result.steps} step${result.steps === 1 ? "" : "s"}`;
};

const describeReview = (outcome: ReviewOutcome | null) => {
  if (!outcome) return "nothing reviewed yet";
  if (outcome.status === "applied") {
    return `applied · ${outcome.accepted.length} accepted, ${outcome.rejected.length} rejected`;
  }
  if (outcome.status === "unavailable") return "unavailable · no editor";
  if (outcome.reason === "dependent-changes") {
    const dependents = outcome.dependencies.flatMap(d => d.dependentIds).length;
    return `BLOCKED · ${dependents} dependent change(s)`;
  }
  if (outcome.reason === "missing-changes") {
    return `BLOCKED · ${outcome.missingIds.length} no longer pending`;
  }
  return `BLOCKED · ${outcome.reason}`;
};

const row: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "space-between",
  fontVariantNumeric: "tabular-nums",
};

const label: React.CSSProperties = { opacity: 0.6, flexShrink: 0 };

export function TrackChangesInspector({ editor }: { editor: Editor | null }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);

  useEffect(() => {
    if (!editor) return;
    const update = () => setSnapshot(read(editor));
    update();
    return editor.subscribe(update);
  }, [editor]);

  const alarming =
    snapshot.tracking?.status === "refused" || snapshot.review?.status === "blocked";

  return (
    <div
      style={{
        padding: "8px 10px",
        borderTop: "1px solid var(--scrivr-react-border, #e2e8f0)",
        background: alarming ? "var(--scrivr-react-notice-surface, #fdf6e7)" : "transparent",
        fontSize: 11,
        lineHeight: 1.6,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div style={row}>
        <span style={label}>tracking</span>
        <span>{describeTracking(snapshot.tracking)}</span>
      </div>
      <div style={row}>
        <span style={label}>review</span>
        <span>{describeReview(snapshot.review)}</span>
      </div>
      <div style={row}>
        <span style={label}>pending</span>
        <span>
          {snapshot.pending}
          {snapshot.authors.length ? ` · ${snapshot.authors.join(", ")}` : ""}
        </span>
      </div>
    </div>
  );
}
