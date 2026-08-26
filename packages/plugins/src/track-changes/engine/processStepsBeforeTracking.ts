import { Transaction } from "@scrivr/core/pm";
import { Step } from "@scrivr/core/pm";

import { TrTrackingContext } from "../types";

export function processStepsBeforeTracking(
  tr: Transaction,
  trContext: TrTrackingContext,
  processors: Array<
    (tr: Transaction, context: TrTrackingContext) => (Step | null)[] | void
  >,
) {
  let steps: Step[] = [];
  processors.forEach(p => {
    const res = p(tr, trContext);
    if (res) {
      // @ts-expect-error Some processors intentionally resize steps array
      steps = res;
      if (steps.length < tr.steps.length) {
        console.warn(
          "Bug! A processor function filtered steps incorrectly. Filtered out steps should be replaced with null and not popped out of the array. Length and order has to be preserved",
        );
      }
    }
  });

  return steps;
}
