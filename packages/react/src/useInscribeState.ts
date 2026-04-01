import { useSyncExternalStore, useState, useLayoutEffect, useRef, useCallback, useDebugValue } from "react";
import type { Editor } from "@inscribe/core";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Context passed to the selector function. */
export interface EditorStateContext {
  editor: Editor;
}

export interface UseEditorStateOptions<T> {
  /** The editor instance from useCanvasEditor. */
  editor: Editor | null;
  /**
   * Pure function that derives the value your component needs.
   * Called on every editor notification — keep it cheap.
   *
   * @example
   * selector: (ctx) => ctx.editor.isActive('bold')
   */
  selector: (ctx: EditorStateContext) => T;
  /**
   * Equality check that gates re-renders.
   * Defaults to deepEqual — deep comparison by value.
   * Pass Object.is for primitive selectors (boolean, string, number).
   */
  equalityFn?: (a: T, b: T) => boolean;
}

interface EditorSnapshot {
  editor: Editor;
  /** Increments on every editor notification. Used to make getSnapshot() stable. */
  version: number;
}

// ── EditorStateManager ────────────────────────────────────────────────────────

/**
 * Wraps editor.subscribe() with a versioned snapshot so that useSyncExternalStore's
 * getSnapshot() returns the same object reference between notifications.
 *
 * Adapted from TipTap's EditorStateManager — the key insight is that useSyncExternalStore
 * requires snapshot reference stability. Without it, getSnapshot() always returns a new
 * object, which React interprets as a store change every render → infinite loop.
 */
class EditorStateManager {
  private version = 0;
  private lastVersion = -1;
  private lastSnapshot: EditorSnapshot | null = null;
  private editor: Editor | null;
  private readonly reactListeners = new Set<() => void>();

  constructor(initialEditor: Editor | null) {
    this.editor = initialEditor;
  }

  setEditor(editor: Editor | null): void {
    this.editor = editor;
  }

  /**
   * Returns the same object reference until increment() is called.
   * This is what makes useSyncExternalStore work — stable snapshot between notifications.
   */
  getSnapshot = (): EditorSnapshot | null => {
    if (this.version === this.lastVersion) return this.lastSnapshot;
    this.lastVersion = this.version;
    this.lastSnapshot = this.editor
      ? { editor: this.editor, version: this.version }
      : null;
    return this.lastSnapshot;
  };

  /** Called when useSyncExternalStore wants to subscribe to the store. */
  subscribe = (callback: () => void): (() => void) => {
    this.reactListeners.add(callback);
    return () => this.reactListeners.delete(callback);
  };

  /** Called by editor.subscribe() on every notification — increments version, notifies React. */
  increment = (): void => {
    this.version++;
    this.reactListeners.forEach((cb) => cb());
  };
}

// ── useEditorState ────────────────────────────────────────────────────────────

/**
 * useEditorState — subscribe to editor state with fine-grained re-render control.
 *
 * Uses useSyncExternalStore with a versioned snapshot (adapted from TipTap):
 *   1. EditorStateManager wraps editor.subscribe() and tracks a version counter.
 *   2. getSnapshot() returns the same reference between notifications (stable).
 *   3. A selector-gated wrapper applies your selector + equalityFn on top.
 *      If the selected value hasn't changed, getSnapshot returns the cached
 *      reference → React sees no change → no re-render.
 *
 * This is concurrent-mode safe (useSyncExternalStore prevents tearing).
 *
 * Returns null when editor is null (not yet initialized).
 *
 * @example
 * // Re-renders only when bold toggles
 * const isBold = useInscribeState({
 *   editor,
 *   selector: (ctx) => ctx.editor.isActive('bold'),
 * })
 *
 * @example
 * // Object selector — re-renders only when one of these actually changes
 * const state = useInscribeState({
 *   editor,
 *   selector: (ctx) => ({
 *     isBold: ctx.editor.isActive('bold'),
 *     blockType: ctx.editor.getBlockInfo().blockType,
 *   }),
 * })
 */
export function useInscribeState<T>(
  options: UseEditorStateOptions<T>
): T | null {
  const { editor, selector, equalityFn = deepEqual as (a: T, b: T) => boolean } = options;

  // Stable manager — created once, updated via setEditor on editor change.
  const [manager] = useState(() => new EditorStateManager(editor));

  // Keep selector and equalityFn fresh without recreating manager or getSelectedSnapshot.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalityFnRef = useRef(equalityFn);
  equalityFnRef.current = equalityFn;

  // Cache the last selected value — returned when equalityFn says nothing changed.
  const lastResultRef = useRef<T | null>(null);
  const hasResultRef = useRef(false);

  // Wire manager to the editor instance. useLayoutEffect so the subscription
  // is established before the browser paints (avoids missed notifications).
  useLayoutEffect(() => {
    manager.setEditor(editor);
    if (!editor) {
      manager.increment(); // flush — clears lastSnapshot for null editor
      return;
    }
    return editor.subscribe(() => manager.increment());
  }, [editor, manager]);

  // The selector-gated snapshot function.
  // - When getSnapshot() returns the same EditorSnapshot reference (no new notification),
  //   this is not called again → no work done.
  // - When a new snapshot arrives, apply the selector and compare with equalityFn.
  //   If equal, return the cached reference → React sees no change → no re-render.
  const getSelectedSnapshot = useCallback((): T | null => {
    const snapshot = manager.getSnapshot();
    if (!snapshot) return null;
    const next = selectorRef.current({ editor: snapshot.editor });
    if (hasResultRef.current && equalityFnRef.current(lastResultRef.current as T, next)) {
      return lastResultRef.current; // stable reference — React skips re-render
    }
    hasResultRef.current = true;
    lastResultRef.current = next;
    return next;
  }, [manager]); // manager is stable — this callback is stable for the lifetime of the hook

  const value = useSyncExternalStore(
    manager.subscribe,
    getSelectedSnapshot,
    () => null, // server snapshot
  );

  useDebugValue(value);
  return value;
}

// ── deepEqual ────────────────────────────────────────────────────────────────

/**
 * Recursive deep equality. Used as the default equalityFn in useEditorState.
 *
 * Handles:
 *   - Primitives (Object.is)
 *   - Arrays (element by element, recursive)
 *   - Plain objects (key by key, recursive)
 *
 * Does NOT handle: Date, RegExp, Map, Set, class instances with custom equality.
 * For those cases, pass a custom equalityFn.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const keysA = Object.keys(aRec);
  const keysB = Object.keys(bRec);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((k) => deepEqual(aRec[k], bRec[k]));
}

/**
 * Shallow equality helper — compares flat objects whose values are primitives.
 * Pass as equalityFn when you know your selector result has no nested arrays/objects.
 *
 * @example
 * equalityFn: shallowEqual
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
