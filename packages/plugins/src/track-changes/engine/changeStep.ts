import { ChangeStep } from "../types";

/**
 * Returns a new array of ChangeSteps with all position fields remapped through
 * the provided Mapping. The input steps are not mutated.
 *
 * This is the explicit "map" stage of the tracking pipeline:
 *
 *   extract → [original coords] → mapChangeSteps → [newTr coords] → apply
 *
 * The cross-step mapping (replayBridge) is resolved here.
 * Intra-batch position shifts produced by applying each step are handled
 * separately by the local accumulator inside processChangeSteps.
 */
export function mapChangeSteps(steps: ChangeStep[], mapping: { map(pos: number): number }): ChangeStep[] {
  return steps.map(step => {
    const remapped = { ...step };
    if ("from"     in remapped) remapped.from     = mapping.map(remapped.from);
    if ("to"       in remapped) remapped.to       = mapping.map(remapped.to);
    if ("pos"      in remapped) remapped.pos      = mapping.map(remapped.pos);
    if ("nodeEnd"  in remapped) remapped.nodeEnd  = mapping.map(remapped.nodeEnd);
    if ("mergePos" in remapped) remapped.mergePos = mapping.map(remapped.mergePos);
    if ("caretAt"  in remapped && remapped.caretAt !== undefined) remapped.caretAt = mapping.map(remapped.caretAt);
    return remapped;
  });
}
