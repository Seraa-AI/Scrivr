// @vitest-environment happy-dom
/**
 * In a browser the page's own `DOMParser` reads the HTML; the result is the
 * same document the server builds.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { importHtml } from "./importHtml";

describe("importHtml — in a browser", () => {
  it("reads the HTML with the page's DOMParser", async () => {
    expect(typeof globalThis.DOMParser).toBe("function");
    const editor = new ServerEditor({ extensions: [StarterKit] });
    const { doc } = await importHtml(
      editor,
      `<h1 data-node-id="t" style="text-align:center">Title</h1><p><a href="https://seraa.ai">link</a></p>`,
    );
    expect(doc.child(0).attrs).toMatchObject({ level: 1, align: "center", nodeId: "t" });
    expect(doc.child(1).firstChild?.marks.map((m) => m.type.name)).toEqual(["link"]);
  });
});
