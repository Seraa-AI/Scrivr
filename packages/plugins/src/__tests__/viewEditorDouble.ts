/**
 * A headless editor that also answers as a view editor, so an extension's
 * `onViewReady` runs in the node test environment. It records the overlay
 * painters registered instead of painting; every other view answer is empty.
 */
import {
  CharacterMap,
  CursorManager,
  SelectionController,
  ServerEditor,
  SurfaceRegistry,
  type DocumentLayout,
  type HoverTarget,
  type IEditor,
  type OverlayRenderHandler,
  type Selection,
  type ServerEditorOptions,
} from "@scrivr/core";

const EMPTY_LAYOUT: DocumentLayout = {
  pages: [],
  pageConfig: { pageWidth: 816, pageHeight: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } },
  version: 0,
  totalContentHeight: 0,
};

export class ViewEditorDouble extends ServerEditor implements IEditor {
  readonly surfaces = new SurfaceRegistry();
  readonly cursorManager = new CursorManager(() => {});
  readonly selection: SelectionController;
  /** The overlay painters extensions registered, in order. */
  readonly painters: OverlayRenderHandler[] = [];
  private readonly charMap = new CharacterMap();

  constructor(options: ServerEditorOptions) {
    super(options);
    this.selection = new SelectionController({
      getState: () => this.getState(),
      dispatch: (tr) => this.applyTransaction(tr),
      ensureLayout: () => {},
      getCharMap: () => this.charMap,
      focus: () => {},
    });
  }

  /** Run every extension's `onViewReady`, as a mounted editor does. */
  mountView(): void {
    for (const ready of this.manager.buildViewReadyCallbacks()) ready(this);
  }

  get layout(): DocumentLayout {
    return EMPTY_LAYOUT;
  }

  addOverlayRenderHandler(handler: OverlayRenderHandler): () => void {
    this.painters.push(handler);
    return () => {
      const at = this.painters.indexOf(handler);
      if (at >= 0) this.painters.splice(at, 1);
    };
  }

  getSelectionDescriptor() {
    return this.describeSelection(this.getState().selection);
  }

  describeSelection(s: Selection) {
    return {
      kind: "text",
      surfaceId: "body",
      empty: s.empty,
      capabilities: { copy: !s.empty, cut: !s.empty, delete: !s.empty, formatText: true, drag: false, resize: false },
      anchor: s.anchor,
      head: s.head,
      from: s.from,
      to: s.to,
    };
  }

  getNodeActions() {
    return [];
  }

  async runNodeAction() {}

  ensureFullLayout(): void {}

  getViewportRect(): DOMRect | null {
    return null;
  }

  getNodeViewportRect(): DOMRect | null {
    return null;
  }

  getNodeViewportRects(): DOMRect[] {
    return [];
  }

  getRangeViewportRects(): DOMRect[] {
    return [];
  }

  getHoverTargets(): readonly HoverTarget[] {
    return [];
  }

  getScrollContainerRect(): DOMRect | null {
    return null;
  }

  selectNode(): void {}

  getPageScreenPosition(): { screenLeft: number; screenTop: number } | null {
    return null;
  }

  scrollRangeIntoView(): boolean {
    return false;
  }

  redraw(): void {}

  invalidateLayout(): void {}

  setReady(): void {}
}
