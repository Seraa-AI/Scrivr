import { isHtmlElement } from "@scrivr/core";

/**
 * Parse HTML into a `<body>` element and hand it to `read` while it is live.
 *
 * In a browser that is the page's own `DOMParser`. On a server there is none,
 * so happy-dom supplies one — imported lazily, so a browser bundle never
 * carries it — in a window that runs no scripts and fetches nothing.
 */
export async function withHtmlBody<T>(html: string, read: (body: HTMLElement) => T): Promise<T> {
  if (typeof globalThis.DOMParser === "function") {
    return read(new globalThis.DOMParser().parseFromString(html, "text/html").body);
  }
  const { Window } = await import("happy-dom");
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  try {
    // happy-dom's element types are its own, not lib.dom's; the guard checks
    // the shape the parse rules rely on.
    const body: unknown = new window.DOMParser().parseFromString(html, "text/html").body;
    if (!isHtmlElement(body)) throw new Error("[importHtml] happy-dom returned no <body>");
    return read(body);
  } finally {
    await window.happyDOM.close();
  }
}
