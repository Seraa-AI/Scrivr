---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Two new ways to seed initial editor content: a `DefaultContent` extension that takes either markdown or JSON, and a widened `content` constructor option that accepts strings (markdown) alongside the existing JSON object. Both surfaces share a single parser implementation; the constructor option overrides any extension contribution. Server users typically reach for `new ServerEditor({ content: "# md" })`, kit-builders compose `DefaultContent.configure({ markdown })` into an extensions list — either path lands the same document.

**@scrivr/core**

- New `DefaultContent` extension at `extensions/built-in/DefaultContent.ts`. Takes `{ markdown?: string } | { json?: object }` (mutually exclusive — throws on both or neither). Use via `DefaultContent.configure({ markdown: "# Hello" })` or `DefaultContent.configure({ json: docJson })`.
- `BaseEditorOptions.content`, `EditorOptions.content`, and `ServerEditorOptions.content` widened from `Record<string, unknown>` to `string | Record<string, unknown>`. Strings are parsed as markdown via the merged extension token map; objects keep the existing JSON path. Passing `content` on the constructor overrides any `DefaultContent` (or other `addInitialDoc`) contribution from the extensions list.
- `addInitialDoc` lifecycle now runs *after* every extension has fully resolved (previously it ran inside each extension's `resolve()`, before others were known). The hook's `this` context is the new `InitialDocContext` — `ExtensionContext` plus a `parseMarkdown(text)` helper that uses the merged token map. This is what lets the extension seed from markdown without an editor instance. Existing extensions that only used `this.schema` keep working unchanged.
- New `parseMarkdownToDoc(schema, tokens, text)` helper in `model/parseMarkdown.ts` — the shared core used by `BaseEditor.parseMarkdown`, the constructor `content` option, and `InitialDocContext.parseMarkdown`. `BaseEditor.parseMarkdown` is now a one-line wrapper.
- New `InitialDocContext` type exported from `extensions/index.ts` for consumers writing custom content-seeding extensions.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
