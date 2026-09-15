import type { FontResource } from "./types";

// Keyed by `FontResource.id`, not by the object: a provider is free to build
// its answer fresh on every call, and identity would install the same bytes
// again on each one.
const installed = new Map<string, Promise<string>>();
let nextFace = 0;

/** Register owned bytes under an isolated name, never an OS family alias. */
export function installCanvasFont(resource: FontResource): Promise<string> {
  const cached = installed.get(resource.id);
  if (cached) return cached;
  const pending = (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
      // Not a missing implementation — this backend has no FontFace to use.
      throw new Error("This environment cannot install fonts: no FontFace API");
    }
    const family = `ScrivrFace${nextFace++}`;
    const face = new FontFace(family, await resource.bytes(), {
      weight: String(resource.weight), style: resource.style,
      ...(resource.stretch ? { stretch: resource.stretch } : {}),
    });
    await face.load();
    document.fonts.add(face);
    return family;
  })();
  // A failure is not cached: bytes that could not be fetched once may arrive on
  // a later layout, and remembering the rejection would make one blocked
  // request permanent for the life of the page.
  installed.set(resource.id, pending);
  void pending.catch(() => {
    if (installed.get(resource.id) === pending) installed.delete(resource.id);
  });
  return pending;
}
