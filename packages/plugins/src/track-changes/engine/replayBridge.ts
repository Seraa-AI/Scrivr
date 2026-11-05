import { Mapping, type Step, type Transaction } from "@scrivr/core/pm";

/**
 * Entering an iteration the bridge maps `docs[i+1]` into the replayed document;
 * leaving it, `docs[i]`. Every step kind advances it. The first replay map
 * mirrors the source step's own, because trackers begin by inverting the source
 * step. A step the replay declined still happened in the source, so its map
 * stays in the chain.
 */
export function advanceBridge(
  step: Step,
  previous: Mapping,
  newTr: Transaction,
  replayStart: number,
) {
  const bridge = new Mapping([step.getMap()]);
  bridge.appendMapping(previous);
  if (newTr.mapping.maps.length > replayStart) {
    bridge.appendMap(newTr.mapping.maps[replayStart]!, 0);
    for (let j = replayStart + 1; j < newTr.mapping.maps.length; j++) {
      bridge.appendMap(newTr.mapping.maps[j]!);
    }
  }
  return bridge;
}
