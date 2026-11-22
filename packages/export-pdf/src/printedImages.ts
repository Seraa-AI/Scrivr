import { resolveOnce, type ImageBytes, type ImageResolver } from "./fetchImage";

/**
 * Images owned by one printing. Capture turns a resolved image into a
 * self-contained URL and pins its bytes, so a later PDF and a plain document
 * viewer read the same image without asking the host to resolve it again.
 */
export interface PrintedImages {
  /** Resolves a captured URL from its pinned bytes, anything else through the host once. */
  resolve: ImageResolver;
  /** The image as a self-contained URL of the bytes resolved for it, or `null` when it resolves to none. */
  capture: (src: string) => Promise<string | null>;
}

export function printedImages(resolve: ImageResolver): PrintedImages {
  const captured = new Map<string, ImageBytes>();
  const once = resolveOnce(async (src) => {
    const image = await resolve(src);
    return image ? { format: image.format, bytes: new Uint8Array(image.bytes) } : null;
  });
  return {
    resolve: (src) => {
      const pinned = captured.get(src);
      return pinned ? Promise.resolve(pinned) : once(src);
    },
    capture: async (src) => {
      const image = await once(src);
      if (!image) return null;
      let binary = "";
      // Bounded calls: a drawing may be megabytes long.
      for (let i = 0; i < image.bytes.length; i += 8192) binary += String.fromCharCode(...image.bytes.subarray(i, i + 8192));
      const url = `data:image/${image.format};base64,${btoa(binary)}`;
      captured.set(url, image);
      return url;
    },
  };
}
