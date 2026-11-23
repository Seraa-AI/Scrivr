/**
 * An app's view of the published package: it imports the built declarations,
 * not the source. CI compiles it against both `@types/react` 18 and 19,
 * because the peer range promises both and the declarations are emitted
 * against only one of them.
 */
import {
  BubbleMenu,
  FloatingMenu,
  ImageMenu,
  LinkPopover,
  Scrivr,
  SlashMenu,
  TableMenu,
  useBubbleMenu,
  useFloatingMenu,
  useImageMenu,
  useLinkPopover,
  useSlashMenu,
  useTableMenu,
} from "@scrivr/react";
import type { AttachableRef } from "@scrivr/react";
import { ReviewRefusalNotice, TrackChangesPanel, TrackChangesPopover, useTrackChangesPopover } from "@scrivr/react/track-changes";
import { HeaderFooterRibbon, useHeaderFooterRibbon } from "@scrivr/react/header-footer";
import { AiSuggestionCardsPanel, AiSuggestionPopover, useAiSuggestionPopover, useBlockMarkerOverlay } from "@scrivr/react/ai";

declare const editor: Parameters<typeof Scrivr>[0]["editor"];
declare const refusal: Parameters<typeof ReviewRefusalNotice>[0]["action"];

export function HeadlessMenus() {
  // Inferred, not annotated: widening each ref to `AttachableRef` would hide
  // the type a hook actually publishes from the `ref` props below.
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
  // An app can name the type, and nothing is mounted until React attaches it.
  const named: AttachableRef<HTMLDivElement> = useBubbleMenu(editor).rootRef;
  const mounted: HTMLDivElement | null = named.current;
  // @ts-expect-error `current` is null until the element mounts.
  named.current.focus();

  return (
    <>
      {refs.map((ref, i) => <div key={i} ref={ref} />)}
      {mounted && <Scrivr editor={editor} />}
    </>
  );
}

export function ShippedComponents() {
  return (
    <>
      <BubbleMenu editor={editor}>
        <button>B</button>
      </BubbleMenu>
      <FloatingMenu editor={editor}>
        <button>H1</button>
      </FloatingMenu>
      <LinkPopover editor={editor} />
      <ImageMenu editor={editor} />
      <TableMenu editor={editor} />
      <SlashMenu editor={editor} />
      <TrackChangesPopover editor={editor} />
      <TrackChangesPanel editor={editor} />
      <ReviewRefusalNotice action={refusal} />
      <HeaderFooterRibbon editor={editor} />
      <AiSuggestionPopover editor={editor} />
      <AiSuggestionCardsPanel editor={editor} />
    </>
  );
}
