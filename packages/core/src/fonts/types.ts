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
 * acquiring bytes is not. `prepare` answers a document's questions ahead of
 * measurement; `resolve` reports what is known now and never blocks. A
 * measurement that asks something `prepare` was never given still gets an
 * answer — the default — and the provider says so, rather than the caller
 * discovering it from the geometry afterwards.
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
  id: string;
  bytes(): Promise<ArrayBuffer>;
  format?: "woff2" | "woff" | "ttf" | "otf";
  /** Holding bytes is not permission to embed them. */
  embedding?: { allowed: boolean; source?: "font-metadata" | "caller" };
}

/** Registered is not loaded: a descriptor costs nothing until something wants it. */
export type FontResourceState = "registered" | "loading" | "loaded" | "failed";

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
}

/** What a consumer needs of an answer, rather than a rule it must remember. */
export interface FontResolutionConstraints {
  /** The result must be usable outside this environment. */
  portable?: boolean;
  /** The result's licence must permit embedding it in an export. */
  embeddable?: boolean;
}

/**
 * Why the answer to a request might have moved. Four reasons rather than one
 * "something changed", because they licence different amounts of re-measuring.
 */
export interface FontProviderChange {
  key: FontKey;
  reason: "resource-added" | "resource-loaded" | "resource-failed" | "resource-removed";
}

export interface FontProvider {
  /** The request text carries when nobody styled it. */
  defaultRequest(): FontRequest;
  /**
   * Answer these ahead of measurement, acquiring whatever bytes that needs.
   * Called once per layout over the document's distinct requests.
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
