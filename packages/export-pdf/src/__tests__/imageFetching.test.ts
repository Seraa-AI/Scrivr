/**
 * Which image URLs an export will request.
 *
 * The document decides what `src` values exist, so exporting one makes this
 * process issue those requests. In a browser that is bounded the way any page
 * request is; on a server it is bounded only by what is written here. So the
 * built-in resolver answers a narrow question — is this a public http(s)
 * address — and everything else becomes a placeholder.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { createDefaultImageResolver } from "../fetchImage";
import { buildPdf } from "../index";
import { block, onePage } from "./fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function mockFetch(impl: (url: URL) => Response) {
  const spy = vi.fn(async (input: unknown) => impl(new URL(String(input))));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe("the URLs an export will fetch", () => {
  it("fetches a public address", async () => {
    const spy = mockFetch(() => new Response(PNG, { status: 200 }));
    const resolved = await createDefaultImageResolver()("https://cdn.example.com/a.png");

    expect(resolved?.format).toBe("png");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["http://127.0.0.1:9200/x.png", "loopback"],
    ["http://localhost/x.png", "localhost by name"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://10.0.0.5/x.png", "a private range"],
    ["http://192.168.1.1/x.png", "a home network"],
    ["http://172.16.3.4/x.png", "the 172.16/12 range"],
    ["http://[::1]/x.png", "IPv6 loopback"],
    ["http://db.internal/x.png", "a private zone"],
    ["file:///etc/passwd", "a non-http scheme"],
  ])("refuses %s — %s — without issuing a request", async (src) => {
    const spy = mockFetch(() => new Response(PNG, { status: 200 }));
    const refusals: string[] = [];

    const resolved = await createDefaultImageResolver((_src, reason) =>
      refusals.push(reason),
    )(src);

    expect(resolved).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(refusals).toHaveLength(1);
  });

  it("re-checks the destination on a redirect", async () => {
    // A public URL that bounces to loopback is the obvious way past a check
    // made only on the URL the document names.
    const spy = mockFetch((url) =>
      url.hostname === "cdn.example.com"
        ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/x.png" } })
        : new Response(PNG, { status: 200 }),
    );
    const refusals: string[] = [];

    const resolved = await createDefaultImageResolver((_src, reason) =>
      refusals.push(reason),
    )("https://cdn.example.com/a.png");

    expect(resolved).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1); // the redirect itself was never followed
    expect(refusals[0]).toContain("127.0.0.1");
  });

  it("stops following redirects rather than looping", async () => {
    const spy = mockFetch((url) =>
      new Response(null, {
        status: 302,
        headers: { location: `https://cdn.example.com/${url.pathname.length + 1}` },
      }),
    );

    expect(await createDefaultImageResolver()("https://cdn.example.com/a")).toBeNull();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("refuses a body larger than it will hold", async () => {
    mockFetch(() =>
      new Response(PNG, { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } }),
    );

    expect(await createDefaultImageResolver()("https://cdn.example.com/big.png")).toBeNull();
  });

  it("reads a data URL without going near the network", async () => {
    const spy = mockFetch(() => new Response(PNG, { status: 200 }));
    const base64 = btoa(String.fromCharCode(...PNG));

    const resolved = await createDefaultImageResolver()(`data:image/png;base64,${base64}`);

    expect(resolved?.format).toBe("png");
    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * The escape hatch. An install whose images genuinely live on an internal host
 * needs a way to say so, and an export of untrusted documents needs a way to
 * be stricter than the default — both are the same seam.
 */
describe("supplying your own resolver", () => {
  it("replaces the built-in policy entirely", async () => {
    const spy = mockFetch(() => new Response(PNG, { status: 200 }));
    const src = "http://images.internal/logo.png";
    const resolveImage = vi.fn(async () => ({ bytes: PNG, format: "png" as const }));

    const editor = new ServerEditor({ extensions: [StarterKit] });
    const layout = onePage([block("image", [], { attrs: { src, width: 40, height: 40 } })]);
    await buildPdf(layout, editor, { resolveImage });

    // The default would have refused this host before issuing a request.
    expect(resolveImage).toHaveBeenCalledWith(src);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports what the built-in policy refused, so it is not a silent placeholder", async () => {
    mockFetch(() => new Response(PNG, { status: 200 }));
    const onImageRefused = vi.fn();
    const src = "http://images.internal/logo.png";

    const editor = new ServerEditor({ extensions: [StarterKit] });
    const layout = onePage([block("image", [], { attrs: { src, width: 40, height: 40 } })]);
    await buildPdf(layout, editor, { onImageRefused });

    expect(onImageRefused).toHaveBeenCalledWith(src, expect.stringContaining("images.internal"));
  });
});
