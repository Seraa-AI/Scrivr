import type {
  FontKey,
  FontProvider,
  FontProviderChange,
  FontRequest,
  FontResolution,
  FontResolutionConstraints,
  FontResource,
  FontSynthesis,
} from "./types";

export interface DefaultFontProviderOptions {
  /**
   * The face text falls back to when nothing else matches. Required: an editor
   * with no default has nothing honest to render unstyled text in, and asking
   * the host is the failure this exists to remove.
   */
  default: FontResource;
  /**
   * The catalogue. A descriptor costs nothing until something resolves to it,
   * so handing over five hundred faces is cheap and fetches nothing.
   */
  resources?: readonly FontResource[];
  /**
   * Families this environment can render but nobody owns the bytes for — a
   * locally installed face. They satisfy a request that has no constraint and
   * are refused one that asks for portability, because there is no way to take
   * them anywhere.
   */
  systemCandidates?: readonly string[];
}

const keyOf = (key: FontKey): string =>
  `${key.family.toLowerCase()}|${key.weight}|${key.style}|${key.stretch ?? ""}`;

const familyOf = (family: string): string => family.toLowerCase();

/**
 * The inventory most applications need: a catalogue of resources they supply,
 * a default they own, and optionally the names of faces the host can draw.
 *
 * Resolution prefers the face that was asked for, then another weight of the
 * same family, then the default. It never invents a family name, and it
 * reports which of those happened rather than leaving it to be inferred from
 * the measurements afterwards.
 */
export class DefaultFontProvider implements FontProvider {
  readonly #default: FontResource;
  readonly #byKey = new Map<string, FontResource>();
  readonly #byFamily = new Map<string, FontResource[]>();
  /** Lowercased name for matching, original spelling for showing. */
  readonly #system: ReadonlyMap<string, string>;
  readonly #loaded = new Set<string>();
  readonly #failed = new Set<string>();
  readonly #pending = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(change: FontProviderChange) => void>();

  constructor(options: DefaultFontProviderOptions) {
    this.#system = new Map(
      (options.systemCandidates ?? []).map((family) => [familyOf(family), family]),
    );
    const owned = new Map<string, FontResource>();
    const inputs = new Map<string, FontResource>();
    for (const input of [options.default, ...(options.resources ?? [])]) {
      if (owned.has(input.id)) {
        if (inputs.get(input.id) !== input) throw new Error(`Duplicate font resource id: ${input.id}`);
        continue;
      }
      // One acquisition per resource. Layout and export receive the same bytes,
      // even if the application's loader fetches mutable remote content.
      let data: Promise<ArrayBuffer> | undefined;
      const resource: FontResource = { ...input, bytes: () => data ??= Promise.resolve().then(() => input.bytes()).then(bytes => bytes.slice(0)) };
      inputs.set(input.id, input);
      owned.set(resource.id, resource);
      this.#byKey.set(keyOf(resource), resource);
      const siblings = this.#byFamily.get(familyOf(resource.family)) ?? [];
      siblings.push(resource);
      this.#byFamily.set(familyOf(resource.family), siblings);
    }
    this.#default = owned.get(options.default.id)!;
  }

  defaultRequest(): FontRequest {
    const { family, weight, style, stretch } = this.#default;
    return { family, weight, style, ...(stretch ? { stretch } : {}), size: 14 };
  }

  async prepare(
    requests: readonly FontRequest[],
    constraints?: FontResolutionConstraints,
  ): Promise<void> {
    // A failure can change the answer to another sibling or the default.
    // Continue until every remaining answer is prepared or no owned face works.
    for (;;) {
      const wanted = new Map<string, FontResource>();
      for (const request of requests) {
        const resource = this.resolve(request, constraints).resource;
        if (resource && !this.#loaded.has(resource.id)) wanted.set(resource.id, resource);
      }

      if (wanted.size === 0) return;
      await Promise.all([...wanted.values()].map(resource => {
        const pending = this.#pending.get(resource.id);
        if (pending) return pending;
        const loading = (async () => {
          try {
            await resource.bytes();
            this.#loaded.add(resource.id);
            this.#emit({ key: resource, reason: "resource-loaded" });
          } catch {
            // A face that will not load is not a reason to lose the document.
            // The next resolve excludes it and chooses the next usable face.
            this.#failed.add(resource.id);
            this.#emit({ key: resource, reason: "resource-failed" });
          }
        })();
        this.#pending.set(resource.id, loading);
        return loading;
      }));
    }
  }

  resolve(
    request: FontRequest,
    constraints?: FontResolutionConstraints,
  ): FontResolution {
    const usable = (resource: FontResource): boolean =>
      !this.#failed.has(resource.id) && (constraints?.embeddable !== true || resource.embedding?.allowed !== false);

    const exact = this.#byKey.get(keyOf(request));
    if (exact && usable(exact)) {
      return this.#answer(request, exact, "requested");
    }

    // Prefer the nearest supplied face, and report the changed weight/slant.
    const sibling = this.#nearest(request.family, request, usable);
    if (sibling) return this.#answer(request, sibling, "substituted");

    // The host can draw it, but nobody can carry it anywhere.
    if (constraints?.portable !== true && this.#system.has(familyOf(request.family))) {
      return {
        request,
        resolved: { family: request.family, source: "requested", portable: false },
      };
    }

    // Falling back to the default family, not to the one default face: a
    // document that asks for a bold this application does not own still means
    // bold, and answering every weight with the regular renders a contract's
    // headings in body text.
    const fallback =
      this.#nearest(this.#default.family, request, usable) ??
      (usable(this.#default) ? this.#default : undefined);
    if (fallback) return this.#answer(request, fallback, "default");

    // Nothing owned can be used here. The host decides, and the answer says so.
    return {
      request,
      resolved: { family: request.family, source: "generic", portable: false },
    };
  }

  /**
   * Everything this inventory can render: the faces it owns bytes for, and the
   * families the host was said to have. A system candidate is offered because
   * it draws on screen; resolving it under an export's constraints is what
   * refuses it, and that refusal is reported rather than silent.
   */
  inventory(): readonly FontKey[] {
    const faces: FontKey[] = [...this.#byKey.values()].map(
      ({ family, weight, style, stretch }) => ({
        family,
        weight,
        style,
        ...(stretch ? { stretch } : {}),
      }),
    );
    for (const [key, family] of this.#system) {
      if (!this.#byFamily.has(key)) {
        faces.push({ family, weight: 400, style: "normal" });
      }
    }
    return faces;
  }

  subscribe(listener: (change: FontProviderChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The face in `family` closest to what was asked for: slant first, then weight. */
  #nearest(
    family: string,
    request: FontRequest,
    usable: (resource: FontResource) => boolean,
  ): FontResource | undefined {
    return (this.#byFamily.get(familyOf(family)) ?? [])
      .filter(usable)
      .sort(
        (a, b) =>
          Number(a.style !== request.style) - Number(b.style !== request.style) ||
          Math.abs(a.weight - request.weight) - Math.abs(b.weight - request.weight),
      )[0];
  }

  #answer(
    request: FontRequest,
    resource: FontResource,
    source: "requested" | "substituted" | "default",
  ): FontResolution {
    // `#nearest` already preferred the real slant over the real weight, so
    // whatever remains here is what no owned face supplies.
    const synthesis: FontSynthesis = {
      ...(resource.weight !== request.weight
        ? { weight: { from: resource.weight, to: request.weight } }
        : {}),
      ...(resource.style !== request.style
        ? { style: { from: resource.style, to: request.style } }
        : {}),
    };

    return {
      request,
      resolved: { family: resource.family, source, portable: true },
      resource,
      ...(synthesis.weight || synthesis.style ? { synthesis } : {}),
    };
  }

  #emit(change: FontProviderChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}
