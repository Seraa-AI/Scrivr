import { Mapping } from "prosemirror-transform";

import { ChangeStep } from "../types";

/**
 * Returns a new array of ChangeSteps with all position fields remapped through
 * the provided Mapping. The input steps are not mutated.
 *
 * This is the explicit "map" stage of the tracking pipeline:
 *
 *   extract → [original coords] → mapChangeSteps → [newTr coords] → apply
 *
 * The cross-step mapping (deletedNodeMapping) is resolved here.
 * Intra-batch position shifts produced by applying each step are handled
 * separately by the local accumulator inside processChangeSteps.
 */
export function mapChangeSteps(steps: ChangeStep[], mapping: Mapping): ChangeStep[] {
  return steps.map(step => {
    const remapped: Partial<Record<string, number>> = {};
    if ("from"     in step) remapped.from     = mapping.map(step.from);
    if ("to"       in step) remapped.to       = mapping.map(step.to);
    if ("pos"      in step) remapped.pos      = mapping.map(step.pos);
    if ("nodeEnd"  in step) remapped.nodeEnd  = mapping.map(step.nodeEnd);
    if ("mergePos" in step) remapped.mergePos = mapping.map(step.mergePos);
    return { ...step, ...remapped } as ChangeStep;
  });
}
