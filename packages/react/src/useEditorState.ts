import { useState, useEffect, useRef } from "react";
import type { Editor } from "@inscribe/core";

/** Context passed to the selector function. */
export interface EditorStateContext {
  editor: Editor;
}

export interface UseEditorStateOptions<T> {
  /** The editor instance from useCanvasEditor. */
  editor: Editor | null;
  /**
   * Pure function that derives the values your component needs.
   * Called on every editor notification — keep it cheap.
   *
   * @example
   * selector: (ctx) => ctx.editor.isActive('bold')
   */
  selector: (ctx: EditorStateContext) => T;
  /**
   * Custom equality check. Defaults to Object.is (reference equality).
   *
   * When your selector returns a new object or array on every call
   * (e.g. getActiveMarks() returns a new array), pass a value-aware
   * equality function so React skips unnecessary re-renders.
   *
   * Use shallowEqual for flat objects whose values are primitives.
   * Write a custom function for objects that contain arrays.
   *
   * @example
   * equalityFn: shallowEqual
   */
  equalityFn?: (a: T, b: T) => boolean;
}

/**
 * useEditorState — subscribe to editor state with fine-grained re-render control.
 *
 * Uses useState + useEffect (not useSyncExternalStore) so the equality check
 * works correctly even when the selector returns new objects on every call
 * (e.g. getActiveMarks() returns a new array each time). setState is only
 * called when equalityFn says the value actually changed.
 *
 * Returns null when editor is null (not yet initialized).
 *
 * @example
 * // Re-renders only when bold toggles
 * const isBold = useEditorState({
 *   editor,
 *   selector: (ctx) => ctx.editor.isActive('bold'),
 * })
 *
 * @example
 * // Multiple values — re-renders only when something actually changes
 * const state = useEditorState({
 *   editor,
 *   selector: (ctx) => ({
 *     isBold: ctx.editor.isActive('bold'),
 *     isItalic: ctx.editor.isActive('italic'),
 *     blockType: ctx.editor.getBlockInfo().blockType,
 *   }),
 *   equalityFn: shallowEqual,
 * })
 */
export function useEditorState<T>(
  options: UseEditorStateOptions<T>
): T | null {
  const { editor, selector, equalityFn = Object.is } = options;

  // Keep selector and equalityFn in refs — stable closure, never stale.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalityFnRef = useRef(equalityFn);
  equalityFnRef.current = equalityFn;

  const [value, setValue] = useState<T | null>(() =>
    editor ? selector({ editor }) : null
  );

  // Ref-track the latest value so the subscription handler can compare
  // without needing `value` in its dependency array (avoids stale closure).
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!editor) {
      setValue(null);
      return;
    }

    // Compute immediately so the initial value reflects the current editor state.
    const initial = selectorRef.current({ editor });
    setValue(initial);
    valueRef.current = initial;

    return editor.subscribe(() => {
      const next = selectorRef.current({ editor });
      if (
        valueRef.current !== null &&
        equalityFnRef.current(valueRef.current, next)
      ) {
        return; // Nothing changed — skip re-render.
      }
      valueRef.current = next;
      setValue(next);
    });
  }, [editor]);

  return value;
}

/**
 * Shallow equality helper for flat object selectors.
 * Pass as equalityFn when your selector returns a plain object whose
 * values are primitives (strings, numbers, booleans).
 *
 * Note: does NOT compare array contents — use a custom function when
 * your selector includes arrays (e.g. activeMarks: string[]).
 */
export function shallowEqual<T extends Record<string, unknown>>(
  a: T,
  b: T
): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((k) => Object.is(a[k], b[k]));
}
