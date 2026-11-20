/**
 * What a consumer imports, through the entries they import it from.
 */
import { describe, it, expect } from "vitest";
import * as core from "@scrivr/core";
import * as docx from "@scrivr/docx";
import * as server from "./index";
import * as browser from "./index.browser";
import type { HtmlDiagnosticCode, HtmlImportDiagnostic, HtmlImportResult, ImportHtml } from "./index";

describe("@scrivr/html exports", () => {
  it("both entries carry the same surface", () => {
    for (const entry of [server, browser]) {
      expect(typeof entry.importHtml).toBe("function");
      expect(entry.HtmlImport.name).toBe("htmlImport");
      expect(entry.applyImportedDocument).toBe(core.applyImportedDocument);
    }
  });

  it("core and docx export what the importers share", () => {
    expect(typeof core.isHtmlElement).toBe("function");
    expect(core.HTML_BLOCK_TAGS.has("td")).toBe(true);
    expect(core.HTML_IGNORED_TAGS.has("script")).toBe(true);
    expect(typeof core.htmlShows).toBe("function");
    expect(typeof core.isHtmlBlock).toBe("function");
    expect(typeof core.pickFile).toBe("function");
    expect(docx.applyImportedDocument).toBe(core.applyImportedDocument);
  });

  it("the result types describe what importHtml returns", async () => {
    const importHtml: ImportHtml = server.importHtml;
    const result: HtmlImportResult = await importHtml(new core.ServerEditor(), "<p>x</p>");
    const diagnostics: HtmlImportDiagnostic[] = result.diagnostics;
    const codes: HtmlDiagnosticCode[] = diagnostics.map((d) => d.code);
    expect(codes).toEqual([]);
  });
});
