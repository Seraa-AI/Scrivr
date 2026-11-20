/** Parse HTML into a `<body>` element and hand it to `read` while it is live. */
export type WithHtmlBody = <T>(html: string, read: (body: HTMLElement) => T) => Promise<T>;

/** The page's own parser. */
export const withPageBody: WithHtmlBody = async (html, read) => {
  if (typeof globalThis.DOMParser !== "function") {
    throw new Error(
      "[importHtml] no DOMParser here. On a server, import @scrivr/html under Node's " +
        "default export condition, which parses with happy-dom.",
    );
  }
  return read(new globalThis.DOMParser().parseFromString(html, "text/html").body);
};
