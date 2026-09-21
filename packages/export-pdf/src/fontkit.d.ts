/**
 * The slice of fontkit v2 this package uses.
 *
 * fontkit ships no types, and `@types/fontkit` describes v1's Node-only
 * signatures (it takes a `Buffer`, where both pdf-lib and a browser pass a
 * `Uint8Array`). Everything else about a font reaches us through pdf-lib, so
 * only what `fonts.ts` calls directly is declared.
 *
 * `create` is declared on both the namespace and the default export because
 * fontkit's node and browser builds differ in which one carries it.
 */
declare module "fontkit" {
  export interface FontkitSubset {
    encode(): Uint8Array;
  }
  export interface FontkitFont {
    createSubset(): FontkitSubset;
  }
  export type FontkitCreate = (bytes: Uint8Array, postscriptName?: string) => FontkitFont;
  export const create: FontkitCreate | undefined;
  const fontkit: { create?: FontkitCreate } | undefined;
  export default fontkit;
}
