/**
 * What a request resolves to, and what the answer admits about itself.
 *
 * The failure this replaces was not a wrong font — it was a font chosen twice,
 * differently, with nothing recording which. So these assert the `source` and
 * `portable` of every answer as much as the family: an answer that cannot say
 * how it was reached is the old behaviour wearing a type.
 */

import { describe, it, expect, vi } from "vitest";
import { DefaultFontProvider } from "./DefaultFontProvider";
import type { FontRequest, FontResource } from "./types";

const resource = (
  family: string,
  weight = 400,
  extra: Partial<FontResource> = {},
): FontResource => ({
  id: `${family}-${weight}`,
  family,
  weight,
  style: "normal",
  bytes: () => Promise.resolve(new ArrayBuffer(8)),
  ...extra,
});

const inter = resource("Inter");
const interBold = resource("Inter", 700);
const fallback = resource("App Default");

const ask = (family: string, weight = 400): FontRequest => ({
  family,
  weight,
  style: "normal",
  size: 14,
});

const provider = (extra: Partial<ConstructorParameters<typeof DefaultFontProvider>[0]> = {}) =>
  new DefaultFontProvider({ default: fallback, resources: [inter, interBold], ...extra });

describe("resolving a request", () => {
  it("gives back the face that was asked for", () => {
    const answer = provider().resolve(ask("Inter", 700));
    expect(answer.resolved).toEqual({ family: "Inter", source: "requested", portable: true });
    expect(answer.resource?.id).toBe(interBold.id);
  });

  it("reaches for another weight of the family before leaving it", () => {
    // 500 is not registered; Inter 400 is closer to the author's intent than
    // a different family would be, so the family is still the one requested.
    const answer = provider().resolve(ask("Inter", 500));
    expect(answer.resolved.source).toBe("substituted");
    expect(answer.resource?.id).toBe(inter.id);
  });

  it("falls to the application's default, and says that is what happened", () => {
    const answer = provider().resolve(ask("Aptos"));
    expect(answer.resolved).toEqual({ family: "App Default", source: "default", portable: true });
    expect(answer.resource?.id).toBe(fallback.id);
  });

  it("matches a family whatever case it was written in", () => {
    expect(provider().resolve(ask("INTER")).resource?.id).toBe(inter.id);
  });
});

describe("a face the host has but nobody owns", () => {
  const withSystem = () => provider({ systemCandidates: ["Aptos"] });

  it("satisfies a request that does not have to travel", () => {
    const answer = withSystem().resolve(ask("Aptos"));
    expect(answer.resolved.source).toBe("requested");
    // The distinction the whole model turns on.
    expect(answer.resolved.portable).toBe(false);
    expect(answer.resource).toBeUndefined();
  });

  it("is refused when the answer has to be portable", () => {
    const answer = withSystem().resolve(ask("Aptos"), { portable: true });
    expect(answer.resolved.source).toBe("default");
    expect(answer.resolved.portable).toBe(true);
  });
});

describe("a resource that may not be embedded", () => {
  const licensed = resource("Licensed", 400, { embedding: { allowed: false } });

  it("renders on screen", () => {
    const answer = provider({ resources: [licensed] }).resolve(ask("Licensed"));
    expect(answer.resource?.id).toBe(licensed.id);
  });

  it("does not reach an export that must embed what it draws", () => {
    const answer = provider({ resources: [licensed] }).resolve(ask("Licensed"), {
      embeddable: true,
    });
    expect(answer.resolved.source).toBe("default");
  });
});

describe("preparing a document's fonts", () => {
  it("acquires only the faces something resolved to", async () => {
    const used = resource("Used");
    const unused = resource("Unused");
    const usedBytes = vi.spyOn(used, "bytes");
    const unusedBytes = vi.spyOn(unused, "bytes");

    const p = new DefaultFontProvider({ default: fallback, resources: [used, unused] });
    await p.prepare([ask("Used")]);

    // Registering a catalogue costs nothing; only what a document asks for is
    // fetched, so a package can hand over hundreds of descriptors.
    expect(usedBytes).toHaveBeenCalledOnce();
    expect(unusedBytes).not.toHaveBeenCalled();
  });

  it("acquires a face once however many runs ask for it", async () => {
    const used = resource("Used");
    const bytes = vi.spyOn(used, "bytes");
    const p = new DefaultFontProvider({ default: fallback, resources: [used] });
    await p.prepare([ask("Used"), ask("Used"), ask("Used")]);
    expect(bytes).toHaveBeenCalledOnce();
  });

  it("reports a face that loaded", async () => {
    const heard: string[] = [];
    const p = provider();
    p.subscribe((change) => heard.push(`${change.reason}:${change.key.family}`));
    await p.prepare([ask("Inter")]);
    expect(heard).toEqual(["resource-loaded:Inter"]);
  });

  it("survives a face that will not load, and says so", async () => {
    const broken = resource("Broken", 400, {
      bytes: () => Promise.reject(new Error("404")),
    });
    const heard: string[] = [];
    const p = new DefaultFontProvider({ default: fallback, resources: [broken] });
    p.subscribe((change) => heard.push(change.reason));

    // A font that will not load is not a reason to lose the document.
    await expect(p.prepare([ask("Broken")])).resolves.toBeUndefined();
    expect(heard).toEqual(["resource-failed", "resource-loaded"]);
    expect(p.resolve(ask("Broken")).resource?.id).toBe(fallback.id);
  });
});
