---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Delete the legacy `table` / `tableRow` / `tableCell` node specs from `schema.ts`. They predated the Table extension plan, used an incompatible `columnWidths` attr, and lacked `isolating` / `parseDOM`. The forthcoming Table extension (Phase 1 step 4+ of `docs/tables.md`) will be the single source of truth for table schema.

**@scrivr/core**

- Removed the `table`, `tableRow`, `tableCell` node specs from `model/schema.ts`. No code path produces or consumes these nodes today — verified by grep across the monorepo.
- Updated `model/schema.test.ts` to drop the table nodes from the required-types list and remove the `columnWidths` attr assertion.
- Documentation (`CLAUDE.md`, `packages/core/README.md`) updated to reflect the trimmed node list.
- Regression sweep per `docs/tables.md` Phase 1 step 3: paragraph/heading/list/listItem/image/hr/pageBreak rendering unchanged. All 842 core tests, 15 export-pdf tests, 311 plugins tests, 12 export-markdown tests green; full typecheck clean across all 12 packages.

**@scrivr/export-pdf**, **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
