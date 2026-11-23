/**
 * A ref a hook hands back for the app to attach to its own element.
 *
 * Declared here rather than inferred from `useRef`: `@types/react` 18 and 19
 * type `useRef<T>(null)` differently, and each rejects the other's result in
 * a `ref` prop. This shape fits both, and still says nothing is attached
 * until React mounts the element.
 */
export interface ElementRef<T extends HTMLElement> {
  readonly current: T | null;
}
