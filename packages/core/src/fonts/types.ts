/**
 * What a document asks for, what an application supplies, and what the two
 * resolve to.
 *
 * A family name is a request; a resource is bytes somebody owns. Keeping them
 * apart is the whole point: the lane that measures and the lane that paints
 * have to agree on a resolution, and they can only do that if someone wrote
 * one down.
 *
 * Resolution is split across two calls because layout is synchronous and
 * acquiring bytes is not. `resolve` reports what is known now and never
 * blocks; `prepare` acquires bytes for what a pass has asked for, so the next
 * pass can answer better. A measurement that asks something `prepare` was
 * never given still gets an answer — the default — and the provider says so,
 * rather than the caller discovering it from the geometry afterwards.
 */

/** What makes one face different from another. Weight and style are identity. */
export interface FontKey {
  family: string;
  /** CSS numeric weight: 400 normal, 700 bold. */
  weight: number;
  style: "normal" | "italic";
  stretch?: string;
}

/** A key plus the size it is wanted at. */
export interface FontRequest extends FontKey {
  size: number;
}

/**
 * A face somebody owns the bytes for.
 *
 * `bytes()` rather than a URL so a resource can come from a bundler asset, a
 * CDN, an object store, or a buffer built at runtime without this contract
 * learning about any of them.
 */
export interface FontResource extends FontKey {
  /**
   * Identity. Two resolutions naming the same `id` are the same face, and the
   * engine caches installs and embeddings against it — so a provider that
   * returns a fresh object per call is still understood, as long as the id is
   * stable. Nothing may be inferred from object identity.
   */
  id: string;
  bytes(): Promise<ArrayBuffer>;
  format?: "woff2" | "woff" | "ttf" | "otf";
  /** Holding bytes is not permission to embed them. */
  embedding?: { allowed: boolean; source?: "font-metadata" | "caller" };
}

/** Registered is not loaded: a descriptor costs nothing until something wants it. */
export type FontResourceState = "registered" | "loading" | "loaded" | "failed";

/**
 * What the physical face does not supply, and the appearance it was asked for.
 *
 * Resolution finds the closest face somebody owns and records what is missing;
 * how — or whether — to make that face satisfy the request is a rendering
 * decision, and the two renderers can answer it differently. Recorded rather
 * than left to be derived, because a consumer comparing a request against a
 * resource is reconstructing a fact the resolver already knew.
 *
 * Present only when a resource answered. An answer with no resource has no
 * physical face to alter, so the host decides the whole appearance.
 */
export interface FontSynthesis {
  /** The face's weight, and the one asked for. */
  weight?: { from: FontKey["weight"]; to: FontKey["weight"] };
  /** The face's slant, and the one asked for. */
  style?: { from: FontKey["style"]; to: FontKey["style"] };
}

export interface FontResolution {
  request: FontRequest;
  resolved: {
    family: string;
    /**
     * `requested` — the face asked for.
     * `substituted` — a different registered face.
     * `default` — the application's default, because nothing matched.
     * `generic` — nothing owned matched; the host decides. Degraded.
     */
    source: "requested" | "substituted" | "default" | "generic";
    /**
     * False when the face exists only because this environment happens to have
     * it. A lane that must reproduce the geometry elsewhere cannot use such a
     * resolution and has to ask again under a constraint.
     */
    portable: boolean;
  };
  resource?: FontResource;
  /** What the resource does not supply of what was asked for. */
  synthesis?: FontSynthesis;
  /**
   * The family name the measurement backend answers to for these bytes, when
   * it installed them under one of its own.
   *
   * Owned bytes are registered under a private name so an operating-system
   * font of the same family cannot answer instead, which means the string
   * handed to the measurer is not the family anybody asked for. Only the code
   * building that string reads this; `resolved.family` stays the name a person
   * would recognise, because everything else — reporting, a font control, an
   * exporter — is talking about the typeface, not about how one backend
   * addresses it.
   */
  measuredAs?: string;
}

/** What a consumer needs of an answer, rather than a rule it must remember. */
export interface FontResolutionConstraints {
  /** The result must be usable outside this environment. */
  portable?: boolean;
  /** The result's licence must permit embedding it in an export. */
  embeddable?: boolean;
}

/**
 * Why the answer to a request might have moved. The reason is informational:
 * the editor re-prepares identically for all of them, and varies nothing.
 */
export interface FontProviderChange {
  key: FontKey;
  reason: "resource-added" | "resource-loaded" | "resource-failed" | "resource-removed";
}

export interface FontProvider {
  /** The request text carries when nobody styled it. */
  defaultRequest(): FontRequest;
  /**
   * Acquire whatever bytes these need. Called once per layout, over the
   * requests a first pass has already discovered — so `resolve` is always
   * asked before `prepare` has ever run, and has to answer anyway.
   */
  prepare(
    requests: readonly FontRequest[],
    constraints?: FontResolutionConstraints,
  ): Promise<void>;
  /** What is known now. Never blocks, because measurement cannot wait. */
  resolve(
    request: FontRequest,
    constraints?: FontResolutionConstraints,
  ): FontResolution;
  /**
   * The faces this provider can answer with, for a caller that has to show a
   * choice rather than make one — a font picker, most obviously.
   *
   * Optional because enumeration is not always possible: a provider backed by
   * a remote catalogue may be able to resolve a name without being able to
   * list every name it would accept. A picker that gets nothing back falls
   * back to whatever it was configured with.
   */
  inventory?(): readonly FontKey[];
  subscribe?(listener: (change: FontProviderChange) => void): () => void;
}

/**
 * The family in effect at the selection, and the face it is actually drawn in.
 *
 * A control showing the document's font needs both: the document names what it
 * was written in, and the editor renders what it holds. Reporting only the
 * first claims a typeface nobody is looking at; reporting only the second
 * rewrites the document in the telling. How loudly to say they differ is the
 * application's decision, not this one's.
 */
export interface ActiveFontFamily {
  /** What the document asks for, with any CSS fallback list already stripped. */
  requested: string;
  /** What it resolved to. Equal to `requested` when the request was honoured. */
  resolved: string;
  substituted: boolean;
}

/**
 * A family a font control may offer, and what backs it.
 *
 * One entry per family rather than per face: bold and italic are marks with
 * their own controls, so offering "Inter Bold" as a choice would both duplicate
 * them and name a family no inventory holds.
 *
 * `faces` is what the application owns, and is empty for a family only the host
 * has — nothing is known about such a family's weights, so claiming it has a
 * regular and nothing else would be worse than saying nothing. `portable` is
 * the fact worth showing beside it: a host family draws on screen and an export
 * cannot carry it, which is worth knowing before a contract is set in it.
 *
 * Whether a given weight will be a designed face or a thickened stand-in is
 * `resolve(...).synthesis`, not something to infer from this list.
 */
export interface FontFamilyOption {
  family: string;
  faces: readonly FontKey[];
  /** False when nothing owns bytes for it, so an export resolves past it. */
  portable: boolean;
}
