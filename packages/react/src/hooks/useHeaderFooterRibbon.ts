import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@scrivr/core";
import {
  createHeaderFooterController,
  type HeaderFooterController,
  type HeaderFooterState,
} from "@scrivr/plugins";
import { useScrivrState as useEditorState } from "./useScrivrState";

export interface HeaderFooterRibbonItem {
  pageNum: number;
  label: string;
  top: number;
  width: number;
  isFirstPage: boolean;
}

export function useHeaderFooterRibbon(editor: Editor | null, gap = 24) {
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

      const pageOffsetY = i * (pageConfig.pageHeight + gap);
      const top = isHeader
        ? pageOffsetY + metrics.contentTop - 28
        : pageOffsetY + metrics.footerTop - 28;

      ribbons.push({
        pageNum,
        label,
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
    optionsOpen,
    setOptionsOpen,
    optionsRef,
    toggleFirstPage,
    removeHeader,
    removeFooter,
  };
}
