import type { FontResource } from "./types";

const installed = new WeakMap<FontResource, Promise<string>>();
let nextFace = 0;

/** Register owned bytes under an isolated name, never an OS family alias. */
export function installCanvasFont(resource: FontResource): Promise<string> {
  const cached = installed.get(resource);
  if (cached) return cached;
  const pending = (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
      throw new Error("This measurer must implement installFont to use owned font resources");
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
  installed.set(resource, pending);
  return pending;
}
