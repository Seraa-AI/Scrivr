import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@scrivr/core";
import {
  createHeaderFooterController,
  type HeaderFooterController,
  type HeaderFooterOptions,
  type HeaderFooterState,
} from "@scrivr/plugins";
import { useScrivrState as useEditorState } from "./useScrivrState";

/**
 * Last-resort ribbon height used when the editor has no `HeaderFooter`
 * extension registered (so `findExtension` returns null). Matches the
 * extension's own default so the visual remains consistent when the
 * fallback kicks in. The live value comes from
 * `HeaderFooter.options.activeEditingGap` — see `readActiveEditingGap`.
 */
const FALLBACK_RIBBON_HEIGHT = 28;

function readActiveEditingGap(editor: Editor | null): number {
  if (!editor) return FALLBACK_RIBBON_HEIGHT;
  const ext = editor.findExtension("headerFooter");
  if (!ext) return FALLBACK_RIBBON_HEIGHT;
  // The extension's options are typed at declaration site as
  // HeaderFooterOptions but the manager's findExtension widens to
  // `object`. Narrow with a runtime check on the field we read.
  const opts = ext.options as Partial<HeaderFooterOptions>;
  return typeof opts.activeEditingGap === "number"
    ? opts.activeEditingGap
    : FALLBACK_RIBBON_HEIGHT;
}

export interface HeaderFooterRibbonItem {
  pageNum: number;
  label: string;
  left: number;
  top: number;
  width: number;
  isFirstPage: boolean;
}

export function useHeaderFooterRibbon(
  editor: Editor | null,
  gap = 24,
  overlayRect: DOMRect | null = null,
) {
  const controllerRef = useRef<HeaderFooterController | null>(null);
  const [state, setState] = useState<HeaderFooterState | null>(null);
  const [optionsOpen, setOptionsOpen] = useState<number | null>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    const controller = createHeaderFooterController(editor);
    controllerRef.current = controller;
    setState(controller.getState());
    const unsub = controller.subscribe(setState);
    return () => {
      unsub();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [editor]);

  useEditorState({
    editor,
    selector: (ctx) => ctx.editor.layout.version,
    equalityFn: Object.is,
  });

  useEffect(() => {
    if (optionsOpen === null) return;
    const handler = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setOptionsOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [optionsOpen]);

  const toggleFirstPage = useCallback(() => {
    controllerRef.current?.toggleFirstPage();
  }, []);

  const removeHeader = useCallback(() => {
    controllerRef.current?.removeHeader();
    setOptionsOpen(null);
  }, []);

  const removeFooter = useCallback(() => {
    controllerRef.current?.removeFooter();
    setOptionsOpen(null);
  }, []);

  const visible = !!editor && !!state?.isSurfaceActive && !!state.activeBand;
  const isHeader = state?.activeBand === "header";
  const differentFirstPage = state?.policy?.differentFirstPage ?? false;
  // Read the extension's configured gap so the ribbon paints at the
  // exact size of the space the layout reserved. Single source of
  // truth — change `HeaderFooter.configure({ activeEditingGap })` and
  // both the layout's reservation and the ribbon's height move together.
  const ribbonHeight = readActiveEditingGap(editor);
  const ribbons: HeaderFooterRibbonItem[] = [];

  if (editor && visible) {
    const layout = editor.layout;
    const pageConfig = layout.pageConfig;
    const pageCount = layout.pages.length;

    for (let i = 0; i < pageCount; i += 1) {
      const pageNum = i + 1;
      const metrics = layout.metrics?.[i];
      if (!metrics) continue;

      const isFirstPage = pageNum === 1 && differentFirstPage;
      const label = isHeader
        ? (isFirstPage ? "First Page Header" : "Header")
        : (isFirstPage ? "First Page Footer" : "Footer");

      const bandHeight = isHeader ? metrics.headerHeight : metrics.footerHeight;
      if (bandHeight <= 0) continue;

      const pageScreen = overlayRect ? editor.getPageScreenPosition(pageNum) : null;
      const pageOffsetY = i * (pageConfig.pageHeight + gap);
      const pageLeft = pageScreen && overlayRect ? pageScreen.screenLeft - overlayRect.left : 0;
      const pageTop = pageScreen && overlayRect
        ? pageScreen.screenTop - overlayRect.top
        : pageOffsetY;
      // Position the ribbon's bottom edge at the body's contentTop
      // (header band) or above the footer's footerTop. `ribbonHeight`
      // matches the gap the extension reserved at layout time, so the
      // ribbon fits exactly without overlapping content above or below.
      const top = isHeader
        ? pageTop + metrics.contentTop - ribbonHeight
        : pageTop + metrics.footerTop - ribbonHeight;

      ribbons.push({
        pageNum,
        label,
        left: pageLeft,
        top,
        width: pageConfig.pageWidth,
        isFirstPage,
      });
    }
  }

  return {
    visible,
    state,
    controller: controllerRef.current,
    isHeader,
    differentFirstPage,
    ribbons,
    /**
     * Pixel height of each ribbon, read from
     * `HeaderFooter.options.activeEditingGap`. Falls back to 28 (the
     * extension default) when no `HeaderFooter` extension is registered.
     */
    ribbonHeight,
    optionsOpen,
    setOptionsOpen,
    optionsRef,
    toggleFirstPage,
    removeHeader,
    removeFooter,
  };
}
