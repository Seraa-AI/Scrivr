import { Transaction } from "@scrivr/core/pm";
import { Step } from "@scrivr/core/pm";

import { TrTrackingContext } from "../types";

/**
 * The gesture's steps, after the processors that group and annotate them have
 * had their say. The steps are the starting point rather than something a
 * processor has to supply, so a processor that only records context (move ids,
 * indentation intent) returns nothing and the list survives untouched.
 *
 * A processor that drops a step must replace it with `null`: the index of a
 * step is how the replay finds the document it applied to, so length and order
 * have to hold.
 */
export function processStepsBeforeTracking(
  tr: Transaction,
  trContext: TrTrackingContext,
  processors: Array<
    (tr: Transaction, context: TrTrackingContext) => (Step | null)[] | void
  >,
) {
  let steps: (Step | null)[] = tr.steps.slice();
  for (const process of processors) {
    const rewritten = process(tr, trContext);
    if (!rewritten) continue;
    if (rewritten.length !== steps.length) {
      console.error(
        "@scrivr/plugins track-changes: a step processor changed the length of the step list; " +
          "a dropped step must be replaced with null so index and order still line up",
      );
      continue;
    }
    steps = rewritten;
  }
  return steps;
}
