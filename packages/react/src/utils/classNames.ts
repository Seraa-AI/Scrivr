/**
 * `cx` — small dependency-free class-name combiner in the `clsx` / `cn` shape.
 *
 * Accepts strings, numbers, falsy values (skipped), nested arrays, and
 * conditional dictionaries. Splits each string token on whitespace, drops
 * exact duplicates while preserving first-occurrence order, and returns
 * `undefined` instead of an empty string so React renders `className`
 * absent rather than empty when no classes apply.
 *
 * Does NOT understand Tailwind utility conflicts (e.g. `cx("p-2", "p-4")`
 * keeps both — last in source order wins via generated CSS). For that,
 * pull in `tailwind-merge`.
 *
 * @example
 *   cx("scrivr-menu", className)                          // positional strings
 *   cx("btn", isActive && "btn-active", { open: isOpen }) // conditional shorthand
 *   cx(["a", ["b", isFlagged && "c"]])                    // nested arrays
 */

type ClassDictionary = Record<string, unknown>;
type ClassArray = ClassValue[];
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassDictionary
  | ClassArray;

export function cx(...inputs: ClassValue[]): string | undefined {
  const classes: string[] = [];

  const add = (input: ClassValue): void => {
    if (!input) return; // false / null / undefined / 0 / ""

    if (typeof input === "string" || typeof input === "number") {
      const text = String(input).trim();
      if (text) classes.push(...text.split(/\s+/));
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) add(item);
      return;
    }

    // ClassDictionary — key is class, truthy value means "include"
    for (const [className, condition] of Object.entries(input)) {
      if (!condition) continue;
      const text = className.trim();
      if (text) classes.push(...text.split(/\s+/));
    }
  };

  for (const input of inputs) add(input);

  // Dedup while preserving first-occurrence order (Set iteration order).
  const deduped = Array.from(new Set(classes));
  return deduped.length > 0 ? deduped.join(" ") : undefined;
}
