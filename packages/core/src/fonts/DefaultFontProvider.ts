import type {
  FontKey,
  FontProvider,
  FontProviderChange,
  FontRequest,
  FontResolution,
  FontResolutionConstraints,
  FontResource,
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
  readonly #system: ReadonlySet<string>;
  readonly #loaded = new Set<string>();
  readonly #listeners = new Set<(change: FontProviderChange) => void>();

  constructor(options: DefaultFontProviderOptions) {
    this.#default = options.default;
    this.#system = new Set((options.systemCandidates ?? []).map(familyOf));
    for (const resource of [options.default, ...(options.resources ?? [])]) {
      this.#byKey.set(keyOf(resource), resource);
      const siblings = this.#byFamily.get(familyOf(resource.family)) ?? [];
      siblings.push(resource);
      this.#byFamily.set(familyOf(resource.family), siblings);
    }
  }

  defaultRequest(): FontRequest {
    return { ...this.#default, size: 14 };
  }

  async prepare(
    requests: readonly FontRequest[],
    constraints?: FontResolutionConstraints,
  ): Promise<void> {
    const wanted = new Map<string, FontResource>();
    for (const request of requests) {
      const resource = this.resolve(request, constraints).resource;
      if (resource && !this.#loaded.has(resource.id)) wanted.set(resource.id, resource);
    }

    await Promise.all(
      [...wanted.values()].map(async (resource) => {
        try {
          await resource.bytes();
          this.#loaded.add(resource.id);
          this.#emit({ key: resource, reason: "resource-loaded" });
        } catch {
          // A face that will not load is not a reason to lose the document.
          // The next resolve sees it missing and answers with the default.
          this.#emit({ key: resource, reason: "resource-failed" });
        }
      }),
    );
  }

  resolve(
    request: FontRequest,
    constraints?: FontResolutionConstraints,
  ): FontResolution {
    const usable = (resource: FontResource): boolean =>
      constraints?.embeddable !== true || resource.embedding?.allowed !== false;

    const exact = this.#byKey.get(keyOf(request));
    if (exact && usable(exact)) {
      return this.#answer(request, exact, "requested");
    }

    // Another weight or slant of the family the author actually asked for is
    // closer to their intent than a different family, so it is still the
    // family they requested rather than a substitution.
    const sibling = (this.#byFamily.get(familyOf(request.family)) ?? [])
      .filter(usable)
      .sort((a, b) => Math.abs(a.weight - request.weight) - Math.abs(b.weight - request.weight))[0];
    if (sibling) return this.#answer(request, sibling, "requested");

    // The host can draw it, but nobody can carry it anywhere.
    if (constraints?.portable !== true && this.#system.has(familyOf(request.family))) {
      return {
        request,
        resolved: { family: request.family, source: "requested", portable: false },
      };
    }

    if (usable(this.#default)) {
      return this.#answer(request, this.#default, "default");
    }

    // Nothing owned can be used here. The host decides, and the answer says so.
    return {
      request,
      resolved: { family: request.family, source: "generic", portable: false },
    };
  }

  subscribe(listener: (change: FontProviderChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #answer(
    request: FontRequest,
    resource: FontResource,
    source: "requested" | "default",
  ): FontResolution {
    return {
      request,
      resolved: { family: resource.family, source, portable: true },
      resource,
    };
  }

  #emit(change: FontProviderChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}
