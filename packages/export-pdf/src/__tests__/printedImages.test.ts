import { expect, it, vi } from "vitest";
import { printedImages } from "../printedImages";
import type { ImageBytes } from "../fetchImage";

it("owns resolved bytes and never sends captured URLs back through the host resolver", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const host = vi.fn(async (): Promise<ImageBytes> => ({ bytes, format: "png" }));
  const images = printedImages(host);
  const src = await images.capture("original");
  if (src === null) throw new Error("the host's image was not captured");
  expect(src).toBe("data:image/png;base64,AQID");
  bytes.fill(0);
  expect(await images.resolve(src)).toEqual({ bytes: new Uint8Array([1, 2, 3]), format: "png" });
  expect(await images.capture("original")).toBe(src);
  expect(host).toHaveBeenCalledTimes(1);
  await images.resolve("logo");
  expect(host).toHaveBeenLastCalledWith("logo");
});
