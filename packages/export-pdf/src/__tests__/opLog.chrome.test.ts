import { describe, it, expect } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { buildPdf } from "../index";
import { recordDrawOps } from "./opLog";
import { layoutWithChrome } from "./fixtures";

/**
 * The chrome lane, characterized without depending on a real chrome
 * contributor: what is under test here is the dispatch — that a registered
 * chrome handler is called once per page with the payload the layout carried,
 * and that its drawing lands in the log alongside the body's.
 *
 * What `HeaderFooter` specifically draws is characterized where it lives, in
 * `@scrivr/plugins`.
 */

/** A chrome contributor that draws one identifiable mark per page. */
const StripeChrome = Extension.create({
  name: "stripeChrome",
  addExports() {
    return {
      pdf: {
        chrome: {
          stripe: (layoutPage: { pageNumber: number }, payload: unknown, ctx: unknown) => {
            const context = ctx as { page: { drawRectangle(o: Record<string, unknown>): void } };
            const height = typeof payload === "object" && payload !== null && "height" in payload
              ? Number((payload as { height: unknown }).height)
              : 4;
            context.page.drawRectangle({
              x: 0,
              y: layoutPage.pageNumber * 10,
              width: 100,
              height,
            });
          },
        },
      },
    };
  },
});

const editor = new ServerEditor({ extensions: [StarterKit, StripeChrome] });

describe("baseline — the chrome lane", () => {
  it("draws chrome alongside the body", async () => {
    const ops = await recordDrawOps(() =>
      buildPdf(layoutWithChrome("stripe", { height: 6 }), editor),
    );
    expect(ops).toMatchSnapshot();
  });

  it("runs once per page, with that page's number", async () => {
    const ops = await recordDrawOps(() =>
      buildPdf(layoutWithChrome("stripe", { height: 6 }, 3), editor),
    );
    // The stripe's y encodes its page number, so the log shows the handler
    // was called per page rather than once for the document.
    const stripes = ops.filter((op) => op.op === "rect" && op["height"] === 6);
    expect(stripes.map((op) => op["y"])).toEqual([10, 20, 30]);
  });

  it("passes the payload the layout carried", async () => {
    const ops = await recordDrawOps(() =>
      buildPdf(layoutWithChrome("stripe", { height: 21 }), editor),
    );
    expect(ops.some((op) => op.op === "rect" && op["height"] === 21)).toBe(true);
  });

  // Unlike node dispatch, which is keyed by type, chrome dispatch calls every
  // registered handler on every page and hands it `undefined` when the layout
  // carried no payload for it. The handler decides whether it has work.
  it("runs a registered handler even when the layout carries no payload for it", async () => {
    const ops = await recordDrawOps(() =>
      buildPdf(layoutWithChrome("nobodyRegisteredThis", { height: 6 }), editor),
    );
    // The stripe still drew, at its no-payload default height.
    expect(ops.some((op) => op.op === "rect" && op["height"] === 4)).toBe(true);
    expect(ops.some((op) => op["height"] === 6)).toBe(false);
  });
});
