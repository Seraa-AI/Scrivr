import { isHtmlElement } from "@scrivr/core";
import { Window } from "happy-dom";
import type { WithHtmlBody } from "./dom";

/**
 * happy-dom's parser, for a server, which has none of its own. The window
 * runs no scripts and fetches nothing: the HTML is read, never rendered.
 */
export const withServerBody: WithHtmlBody = async (html, read) => {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      enableCSSFileLoading: false,
      enableIframePageLoading: false,
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
};
