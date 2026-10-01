/**
 * BlockMarkers — a place to anchor something about a block that proposes no
 * edit to it.
 *
 * The AI suggestion overlay is a diff: `computeAiSuggestion` drops a block
 * whose proposed text matches what is already there, which is right, because
 * a finding with no change is not a diff. A review that answers "this reads as
 * intended" or "a person has to decide this" still has somewhere it belongs in
 * the document, and that is here — a separate layer rather than a suggestion
 * that suggests nothing.
 */
import { Extension } from "@scrivr/core";
import { blockMarkersPlugin } from "./BlockMarkersPlugin";

export const BlockMarkers = Extension.create({
  name: "blockMarkers",
  addProseMirrorPlugins: () => [blockMarkersPlugin],
});
