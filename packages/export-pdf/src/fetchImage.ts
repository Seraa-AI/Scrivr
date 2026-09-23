/**
 * Turning an image `src` into bytes, under limits.
 *
 * A document names its own image URLs, and exporting one makes this process
 * request every URL it names. In a browser that is bounded by the same rules
 * as any other page request. On a server it is not bounded by anything: the
 * exporter will happily fetch `http://127.0.0.1:9200/` or a cloud metadata
 * endpoint on behalf of whoever wrote the document.
 *
 * So the built-in resolver refuses destinations that are not routable on the
 * public internet, caps how long it will wait and how much it will read, and
 * re-checks the destination on every redirect — a public URL that redirects to
 * loopback is the obvious way around a check made only once.
 *
 * What this cannot see is DNS: a public hostname that resolves to a private
 * address passes, because resolution happens inside `fetch`. An export of
 * genuinely untrusted documents should supply its own `resolveImage` and do
 * the check where the address is known.
 */

/** Decoded image bytes and the format the embedder should read them as. */
export interface ImageBytes {
  bytes: Uint8Array;
  format: "png" | "jpeg";
}

/** How an image `src` becomes bytes. */
export type ImageResolver = (src: string) => Promise<ImageBytes | null>;

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** PNG's signature; everything else the embedder reads is JPEG. */
const formatOf = (bytes: Uint8Array): "png" | "jpeg" =>
  bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : "jpeg";

function decodeDataUrl(src: string): ImageBytes | null {
  const comma = src.indexOf(",");
  if (comma === -1) return null;
  const header = src.slice(0, comma);
  const body = src.slice(comma + 1);
  if (!header.includes(";base64")) return null;
  const binary = atob(body);
  if (binary.length > MAX_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, format: header.includes("png") ? "png" : "jpeg" };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Addresses that are not reachable from the public internet, and so are only
 * reachable *from here* — which is the whole of the exposure.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // `.local` is mDNS; `.internal` is the conventional private zone and what
  // several cloud metadata services answer on.
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;

  // IPv6: loopback, unique-local (fc00::/7) and link-local (fe80::/10).
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // An IPv4 address written as IPv6, which is the same address.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (mapped) return isPrivateHost(mapped[1]!);

  const v4 = IPV4.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local, and where cloud metadata lives.
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10, carrier-grade NAT, routable only inside a provider.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Why a destination was refused, or null if it is allowed. */
export function refuseReason(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `unsupported scheme "${url.protocol}"`;
  }
  if (isPrivateHost(url.hostname)) {
    return `"${url.hostname}" is not a public address`;
  }
  return null;
}

async function readCapped(res: Response): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return null;
  return new Uint8Array(buf);
}

/**
 * The resolver used when the caller supplies none.
 *
 * `onRefused` is how a refusal reaches someone: the export still produces a
 * placeholder, and a silent placeholder is indistinguishable from a broken
 * link.
 */
export function createDefaultImageResolver(
  onRefused?: (src: string, reason: string) => void,
): ImageResolver {
  return async function resolveImage(src: string): Promise<ImageBytes | null> {
    if (src.startsWith("data:")) return decodeDataUrl(src);

    let url: URL;
    try {
      url = new URL(src);
    } catch {
      return null;
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const reason = refuseReason(url);
      if (reason !== null) {
        onRefused?.(src, reason);
        return null;
      }
      let res: Response;
      try {
        res = await fetch(url, {
          // Followed by hand so every hop is checked, not just the first.
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return null;
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        try {
          url = new URL(location, url);
        } catch {
          return null;
        }
        continue;
      }

      if (!res.ok) return null;
      const bytes = await readCapped(res).catch(() => null);
      return bytes ? { bytes, format: formatOf(bytes) } : null;
    }

    onRefused?.(src, `more than ${MAX_REDIRECTS} redirects`);
    return null;
  };
}
