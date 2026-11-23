/**
 * Collaboration lives at "@scrivr/plugins/collaboration", the one entry that
 * loads Yjs and Hocuspocus. Re-exporting it here would make every React app
 * load them, collaboration or not.
 */
import { expect, it } from "vitest";
import * as react from "./index";

it("@scrivr/react does not re-export collaboration", () => {
  expect(Object.keys(react)).not.toContain("Collaboration");
  expect(Object.keys(react)).not.toContain("CollaborationCursor");
});
