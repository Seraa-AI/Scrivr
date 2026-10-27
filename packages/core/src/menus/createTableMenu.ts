/**
 * createTableMenu — framework-agnostic controller for a table popover.
 *
 * Two presentations (docs/hover-popovers-rfc.md §5):
 *   - "peek" when the pointer rests on a table — rows × columns, header row.
 *   - "full" when cells are selected — the consumer adds the selection's node
 *     actions (`editor.getNodeActions()`).
 * Selection wins: while cells are selected, hover is ignored.
 *
 * The rect passed to the callbacks is the table's top edge on the first page
 * fragment that is on screen, so a popover placed above it sits clear of the
 * table however tall the table is.
 *
 * @example — vanilla JS
 *   const cleanup = createTableMenu(editor, {
 *     onShow: (rect, info) => { … `${info.rows} × ${info.columns}` … },
 *     onMove: (rect, info) => { … },
 *     onHide: () => { … },
 *   });
 */
import type { Node } from "prosemirror-model";
import type { IEditor } from "../extensions/types";
import type { HoverTarget } from "../hover/types";
import { describeTable, type TableShape } from "../table/describeTable";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { isAnchorInsideContainer } from "./anchorVisibility";
import {
  resolveHoverOption,
  subscribeHoverTarget,
  type HoverOption,
  type PopoverPresentation,
} from "./subscribeHoverTarget";

export interface TableMenuInfo extends TableShape {
  /** Doc position of the table node. */
  docPos: number;
  /** "peek" when shown from hover, "full" when cells are selected. */
  presentation: PopoverPresentation;
}

export interface TableMenuCallbacks {
  onShow(rect: DOMRect, info: TableMenuInfo): void;
  onHide(): void;
  onMove(rect: DOMRect, info: TableMenuInfo): void;
}

export interface TableMenuOptions extends TableMenuCallbacks {
  /** The popover's root; keeps a peek open while the pointer is over it. */
  getPopoverElement?: () => HTMLElement | null;
  /** Hover peeks. Default true; false shows the menu from the selection only. */
  hover?: HoverOption;
}

export function createTableMenu(editor: IEditor, options: TableMenuOptions): () => void {
  const { onShow, onHide, onMove } = options;

  let visible = false;
  let lastDocPos = -1;
  let rafId: number | null = null;
  let hovered: HoverTarget | null = null;

  function hide() {
    if (visible) { visible = false; lastDocPos = -1; onHide(); }
  }

  /** The table holding a cell selection — the full presentation. */
  function selectedTable(): number | null {
    if (editor.surfaces.activeSurface) return null;
    const descriptor = editor.getSelectionDescriptor();
    if (descriptor.kind !== "table-cell") return null;
    return tableAround(editor.getState().doc, descriptor.from);
  }

  function hoveredTable(): number | null {
    if (!hovered) return null;
    const node = nodeAt(editor.getState().doc, hovered.pos);
    return node?.type.name === "table" ? hovered.pos : null;
  }

  function update() {
    const full = selectedTable();
    const docPos = full ?? hoveredTable();
    const table = docPos === null ? null : nodeAt(editor.getState().doc, docPos);
    if (docPos === null || !table) { hide(); return; }

    const container = editor.getScrollContainerRect();
    const fragment = editor
      .getNodeViewportRects(docPos)
      .find((r) => isAnchorInsideContainer(r, container));
    if (!fragment) { hide(); return; }
    const top = container ? Math.max(fragment.top, container.top) : fragment.top;
    const rect = new DOMRect(fragment.left, top, fragment.width, 1);

    const info: TableMenuInfo = {
      docPos,
      ...describeTable(table),
      presentation: full !== null ? "full" : "peek",
    };

    if (visible && lastDocPos === docPos) {
      onMove(rect, info);
    } else {
      visible = true;
      lastDocPos = docPos;
      onShow(rect, info);
    }
  }

  function scheduleUpdate() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { rafId = null; update(); });
  }

  const unsubscribe = subscribeViewUpdates(editor, scheduleUpdate);
  const hoverDelays = resolveHoverOption(options.hover);
  const offHover = hoverDelays
    ? subscribeHoverTarget(
        editor,
        "table",
        (target) => { hovered = target; scheduleUpdate(); },
        { ...hoverDelays, ...(options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {}) },
      )
    : () => {};
  const offFocusOutside = subscribeEditorFocusOutside(
    editor,
    () => {
      if (hovered && selectedTable() === null) return;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      hide();
    },
    options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {},
  );

  return () => {
    unsubscribe();
    offHover();
    offFocusOutside();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    hide();
  };
}

function nodeAt(doc: Node, pos: number): Node | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  return doc.nodeAt(pos);
}

function tableAround(doc: Node, pos: number): number | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "table") return $pos.before(depth);
  }
  // A CellSelection's `from` can sit just inside the table, before its first row.
  const after = $pos.nodeAfter;
  return after?.type.name === "table" ? pos : null;
}

