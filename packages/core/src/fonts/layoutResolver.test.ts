/**
 * What layout measures once a provider has answered.
 *
 * A span that records one face and was measured in another is the bug this
 * whole lane exists to remove, so the thing worth asserting is not that a
 * resolution was attached — it is that the string handed to the measurer
 * carries the resolved family.
 */

import { describe, it, expect } from "vitest";
import { createLayoutFontResolver } from "./layoutResolver";
import { DefaultFontProvider } from "./DefaultFontProvider";
import type { FontResource } from "./types";

const resource = (family: string, weight = 400): FontResource => ({
  id: `${family}-${weight}`,
  family,
  weight,
  style: "normal",
  bytes: () => Promise.resolve(new ArrayBuffer(8)),
});

const provider = (families: string[] = [], systemCandidates: string[] = []) =>
  new DefaultFontProvider({
    default: resource("App Sans"),
    resources: families.map((f) => resource(f)),
    systemCandidates,
  });

describe("resolving a span's font for measurement", () => {
  it("hands back the family that was asked for when it is owned", () => {
    const r = createLayoutFontResolver(provider(["Inter"]));
    expect(r.resolve("14px Inter").font).toBe("14px Inter");
  });

  it("rewrites the family when it resolved to something else", () => {
    // The measurer is about to be handed this string. If it still said
    // "Aptos" the geometry would come from whatever the host picked, and the
    // recorded resolution would describe a face nothing measured.
    const r = createLayoutFontResolver(provider());
    expect(r.resolve("14px Aptos").font).toBe("14px App Sans");
  });

  it("keeps weight and slant while replacing the family", () => {
    const r = createLayoutFontResolver(provider());
    expect(r.resolve("italic bold 18px Aptos").font).toBe("italic bold 18px App Sans");
  });

  it("reads bold and italic out of the shorthand as part of the request", () => {
    const r = createLayoutFontResolver(provider(["Inter"]));
    // Inter 700 is not registered, so this resolves through the family and
    // is a different answer from the 400 — two ids, not one.
    const plain = r.resolve("14px Inter");
    const bold = r.resolve("bold 14px Inter");
    expect(plain.font).toBe("14px Inter");
    expect(bold.font).toBe("bold 14px Inter");
  });

  it("gives one id to one answer, however many spans ask", () => {
    const r = createLayoutFontResolver(provider());
    const a = r.resolve("14px Aptos");
    const b = r.resolve("14px Calibri");
    // Different requests, same answer — a document's thousands of runs should
    // not become thousands of resolution objects.
    expect(a.resolution).toBe(b.resolution);
    expect(r.table().size).toBe(1);
  });

  it("records how each answer was reached", () => {
    const r = createLayoutFontResolver(provider(["Inter"]));
    r.resolve("14px Inter");
    r.resolve("14px Aptos");
    const sources = [...r.table().values()].map((res) => res.resolved.source).sort();
    expect(sources).toEqual(["default", "requested"]);
  });

  it("quotes a family the shorthand could not carry bare", () => {
    // An invalid shorthand is ignored by `ctx.font` rather than rejected, so
    // the span would be measured in whatever the previous one left behind.
    const p = new DefaultFontProvider({ default: resource("Acme 2.0 Sans") });
    const r = createLayoutFontResolver(p);
    expect(r.resolve("14px Aptos").font).toBe('14px "Acme 2.0 Sans"');
  });

  it("gives an export a different answer than the screen", () => {
    const p = provider([], ["Aptos"]);
    const screen = createLayoutFontResolver(p);
    const exported = createLayoutFontResolver(p, { portable: true });

    // The host can draw Aptos; nothing can carry it to a PDF.
    expect(screen.resolve("14px Aptos").font).toBe("14px Aptos");
    expect(exported.resolve("14px Aptos").font).toBe("14px App Sans");
  });
});
