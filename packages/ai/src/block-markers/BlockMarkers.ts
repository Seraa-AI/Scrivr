/**
 * BlockMarkers — where a finding that proposes no edit lives.
 *
 * `computeAiSuggestion` drops a block whose proposed text is unchanged, which
 * is right: a finding with no change is not a diff. A review answering "this
 * reads as intended", or "a person has to decide this", still belongs
 * somewhere in the document, and it is not the diff overlay.
 */
import { Extension } from "@scrivr/core";
import { blockMarkersPlugin } from "./BlockMarkersPlugin";

export const BlockMarkers = Extension.create({
  name: "blockMarkers",
  addProseMirrorPlugins: () => [blockMarkersPlugin],
});
