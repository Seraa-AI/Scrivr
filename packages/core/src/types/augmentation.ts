/**
 * augmentation.ts
 *
 * Module augmentation entry-point for @scrivr/core.
 *
 * Extensions and consumer apps declare their additions here:
 *
 * ```ts
 * // In your extension file:
 * declare module "@scrivr/core" {
 *   interface Commands<ReturnType> {
 *     myExtension: {
 *       doSomething: (arg: string) => ReturnType;
 *     };
 *   }
 * }
 * ```
 */

// ── Utility types ─────────────────────────────────────────────────────────────

/**
 * Flattens a union type into an intersection type.
 * UnionToIntersection<A | B | C> → A & B & C
 */
export type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
    ? I
    : never;

/**
 * Merges all command namespaces into a single flat object type,
 * where each command is callable directly:  editor.commands.toggleBold()
 */
export type FlatCommands<R> = UnionToIntersection<Commands<R>[keyof Commands<R>]>;

/**
 * Safe fallback: if no `Commands` augmentations have been declared the
 * keyof is `never`, so we fall back to a permissive record instead of
 * collapsing to `unknown`.
 */
export type SafeFlatCommands = [keyof Commands<void>] extends [never]
  ? Record<string, (...args: unknown[]) => void>
  : FlatCommands<void>;

// ── Augmentable interfaces ────────────────────────────────────────────────────

/**
 * Commands contributed by extensions.
 *
 * Augment this interface in your extension to get typed `editor.commands.*`.
 *
 * @typeParam ReturnType - `void` for direct calls, `Command` for chaining.
 *
 * @example
 * declare module "@scrivr/core" {
 *   interface Commands<ReturnType> {
 *     bold: {
 *       toggleBold: () => ReturnType;
 *       setBold: () => ReturnType;
 *       unsetBold: () => ReturnType;
 *     };
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Commands<ReturnType> {} // augmented by extensions

/**
 * Attributes for node types.
 *
 * @example
 * declare module "@scrivr/core" {
 *   interface NodeAttributes {
 *     heading: { level: number; align?: string };
 *     paragraph: { align?: string };
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NodeAttributes {} // augmented by extensions

/**
 * Attributes for mark types.
 *
 * @example
 * declare module "@scrivr/core" {
 *   interface MarkAttributes {
 *     color: { color: string };
 *     font_size: { size: number };
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MarkAttributes {} // augmented by extensions

/**
 * Editor event map. Augment to get typed `editor.on("eventName", handler)`.
 *
 * @example
 * declare module "@scrivr/core" {
 *   interface EditorEvents {
 *     focus: void;
 *     blur: void;
 *     update: { docChanged: boolean };
 *   }
 * }
 */
export interface EditorEvents {
  focus: void;
  blur: void;
  update: { docChanged: boolean };
  destroy: void;
  /**
   * Fired when the viewport changes without a state update — i.e. the user
   * scrolled or the scroll container was resized. Doc/selection are unchanged.
   *
   * Anchored UI (popovers, bubble menus) subscribes to this so its
   * viewport-space position can follow the anchor as it scrolls. State-only
   * listeners should stick with `"update"` to avoid needless work on scroll.
   */
  viewport: void;
}

/**
 * Per-extension storage. Augment to get typed `editor.storage.myExtension.*`.
 *
 * @example
 * declare module "@scrivr/core" {
 *   interface ExtensionStorage {
 *     trackChanges: { pendingCount: number };
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ExtensionStorage {} // augmented by extensions

// ── Typed getNodeAttrs / getMarkAttrs helpers ─────────────────────────────────

/**
 * Typed attribute getter for a node type.
 * Returns the known attribute shape if `K` is in `NodeAttributes`, otherwise `Record<string, unknown>`.
 */
export type NodeAttrsFor<K extends string> =
  K extends keyof NodeAttributes ? NodeAttributes[K] : Record<string, unknown>;

/**
 * Typed attribute getter for a mark type.
 * Returns the known attribute shape if `K` is in `MarkAttributes`, otherwise `Record<string, unknown>`.
 */
export type MarkAttrsFor<K extends string> =
  K extends keyof MarkAttributes ? MarkAttributes[K] : Record<string, unknown>;
