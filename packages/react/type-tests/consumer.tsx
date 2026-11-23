/**
 * An app's view of the published package: it imports the built declarations,
 * not the source. CI compiles it against both `@types/react` 18 and 19,
 * because the peer range promises both and the declarations are emitted
 * against only one of them.
 */
import { Scrivr, useBubbleMenu, useFloatingMenu, useImageMenu, useLinkPopover, useSlashMenu, useTableMenu } from "@scrivr/react";
import { useTrackChangesPopover } from "@scrivr/react/track-changes";
import { useHeaderFooterRibbon } from "@scrivr/react/header-footer";
import { useAiSuggestionPopover, useBlockMarkerOverlay } from "@scrivr/react/ai";

declare const editor: Parameters<typeof Scrivr>[0]["editor"];

export function HeadlessMenus() {
  const refs = [
    useBubbleMenu(editor).rootRef,
    useFloatingMenu(editor).rootRef,
    useLinkPopover(editor).rootRef,
    useImageMenu(editor).rootRef,
    useTableMenu(editor).rootRef,
    useSlashMenu(editor).rootRef,
    useTrackChangesPopover(editor).rootRef,
    useHeaderFooterRibbon(editor).optionsRef,
    useAiSuggestionPopover(editor).rootRef,
    useBlockMarkerOverlay(editor).rootRef,
  ];
  // Nothing is mounted until React attaches the ref, so an app has to check.
  const mounted: HTMLDivElement | null = refs[0]?.current ?? null;

  return (
    <>
      {refs.map((ref, i) => <div key={i} ref={ref} />)}
      {mounted && <Scrivr editor={editor} />}
    </>
  );
}
