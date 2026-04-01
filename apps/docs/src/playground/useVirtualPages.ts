import { useEffect, useRef, useState, useCallback } from "react";
import { LayoutPage } from "@scrivr/core";

export interface VirtualPageState {
  /** Page numbers currently considered visible (within overscan distance) */
  visiblePages: Set<number>;
  /** Ref callback to attach to each page's container div */
  observePage: (pageNumber: number) => (el: HTMLDivElement | null) => void;
}

/**
 * useVirtualPages — tracks which pages are within the viewport + overscan buffer.
 *
 * Uses IntersectionObserver with a rootMargin to trigger rendering slightly
 * before pages enter the viewport, eliminating white flash on scroll.
 *
 * @param pages     — all pages from DocumentLayout
 * @param overscan  — extra pixels beyond viewport to consider visible (default 500)
 */
export function useVirtualPages(
  pages: LayoutPage[],
  overscan = 500
): VirtualPageState {
  const [visiblePages, setVisiblePages] = useState<Set<number>>(
    // Start with page 1 visible so the first render is immediate
    () => new Set([1])
  );

  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNumber = Number(entry.target.getAttribute("data-page"));
            if (entry.isIntersecting) {
              next.add(pageNumber);
            } else {
              next.delete(pageNumber);
            }
          }
          return next;
        });
      },
      {
        // rootMargin: render pages this many pixels outside the visible viewport
        rootMargin: `${overscan}px`,
        threshold: 0,
      }
    );

    // Re-observe all currently tracked elements
    for (const el of elementsRef.current.values()) {
      observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [overscan]);

  // Reset visible pages when the page list changes (doc restructure)
  useEffect(() => {
    setVisiblePages(new Set([1]));
  }, [pages.length]);

  const observePage = useCallback(
    (pageNumber: number) => (el: HTMLDivElement | null) => {
      if (el) {
        el.setAttribute("data-page", String(pageNumber));
        elementsRef.current.set(pageNumber, el);
        observerRef.current?.observe(el);
      } else {
        const prev = elementsRef.current.get(pageNumber);
        if (prev) {
          observerRef.current?.unobserve(prev);
          elementsRef.current.delete(pageNumber);
        }
      }
    },
    []
  );

  return { visiblePages, observePage };
}
