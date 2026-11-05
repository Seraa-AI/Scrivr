---
"@scrivr/core": patch
"@scrivr/docx": patch
---

`importDocx` and `exportDocx` now return a `report` next to `diagnostics`: what the conversion kept, dropped and changed, so an app can tell a user what their file lost.

- **`report.counts`** has a total for each kind of content (`paragraph`, `hardBreak`, `image`, and on import Word's run properties such as `b`). **`report.entries`** lists each distinct drop and change with its reason, its `count`, and its `owner`. The owner is the extension that recorded it, `"overrides"` for a handler passed in the call, or `null` when nothing handled the content. Identical drops share one entry, so a property Word sets on every run is one line, not thousands. Existing result fields are unchanged.
- **The converter records outcomes, even when a handler says nothing.** Each item handed to a handler counts as kept when the handler returns content, and dropped (`"handler returned nothing"`) when it returns nothing. Content with no handler is dropped with `"no handler"`. A top-level Word element the parser cannot read is dropped with `"no parser"`. When an item is lost, everything inside it is counted as dropped with it, so the report never claims text that is not in the output. A link is counted by its run wrapper, which is what writes the hyperlink. Elements the parser skips inside a paragraph or run are not yet covered.
- **`DocxContext` and `DocxImportContext` gain a required `report`** (`kept`, `dropped`, `changed`). A handler uses it to add what the converter cannot see, such as `changed("paragraph", "spacing ignored")`. When a handler reports `kept` or `dropped` for the kind it was handed, its account replaces the converter's. A `kept` count that is not a whole number is ignored with a `report-invalid-count` warning, rather than failing the conversion. A context built by hand must now provide `report`.
- **`IBaseEditor.getFormatContributions()`** returns each extension's export and import contributions together with the extension's name. It is new on the interface, so a hand-written `IBaseEditor` implementation must add it. `getExportContributions()` and `getImportContributions()` are deprecated in its favour, and still work.
- **Export no longer warns `unsupported-mark` for a mark that has only a run wrapper.** The wrapper carries the mark across, and the report counts it as kept.
- `@scrivr/docx` exports the `WalkerHandlers`, `WalkerHandlerOwners` and `HandlerOwner` types that `walkDocument` takes.
- **`normalizeDrawNumber`** is exported from `@scrivr/core`. It rounds to three decimals and turns `-0` into `0`. It is the rule the PDF op log uses, exported so other snapshot logs can share it.
