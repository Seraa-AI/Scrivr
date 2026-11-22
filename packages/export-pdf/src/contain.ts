/** `size` scaled to fit inside `box` in its own proportions — how a drawing sits in its field, on the page and on a certificate. */
export function containedSize(size: { width: number; height: number }, box: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(box.width / size.width, box.height / size.height);
  return { width: size.width * scale, height: size.height * scale };
}
