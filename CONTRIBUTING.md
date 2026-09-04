# Contributing to Scrivr

Thank you for your interest in contributing. This document covers how to report bugs, propose changes, and get your code merged.

## Before You Start

- **Search existing issues and PRs** before opening a new one — your problem or idea may already be tracked.
- **Open a discussion** for large features or architectural changes before writing code. This prevents wasted effort.
- **Open an issue** for bug reports. Include a minimal reproduction and the expected vs actual behaviour.

## Branch Naming

| Type | Format | Example |
|------|--------|---------|
| Feature | `feat/short-description` | `feat/image-resize-handles` |
| Bug fix | `fix/short-description` | `fix/cursor-position-after-undo` |
| Documentation | `docs/short-description` | `docs/api-reference-updates` |
| Refactor | `refactor/short-description` | `refactor/char-map-interval-tree` |

Always branch from `main`.

## Pull Request Process

1. Fork the repository and create your branch.
2. Make your changes — follow the coding conventions in the codebase.
3. Run `pnpm test` and ensure all tests pass.
4. Run `pnpm typecheck` — zero errors required.
5. Update the relevant documentation page in `apps/docs/content/docs/`.
6. Add a changeset (`pnpm changeset`) if you changed a package's source — see below.
7. Open a Pull Request against `main` with a clear description of what changed and why.
8. A maintainer will review your PR, request changes if needed, and merge when ready.

## Changesets

Two rules, and both come down to the same thing: state what you changed, and
let the config do the rest.

**Use `patch`.** Every release during 1.x beta is a patch. A stray `minor` or
`major` in a changeset rewrites the version plan for the whole lockstep group,
and the `No Unintended Major` CI check exists because that has happened.

**List only the packages whose source you actually changed.** Usually that is
one. You do not need to list the others by hand:

- `fixed` in `.changeset/config.json` moves the lockstep group to the same
  version together, whether or not a changeset names them.
- `updateInternalDependencies` bumps anything that depends on what you changed
  — including `@scrivr/export`, which is deliberately *not* in the `fixed`
  group.

Listing packages you did not touch does not change the versions anyone gets. It
copies your entry verbatim into their `CHANGELOG.md`, so a reader of
`packages/react/CHANGELOG.md` finds a detailed description of a change React had
no part in. Check the plan before opening the PR:

```bash
npx changeset status --verbose
```

**One story per changeset.** A PR that fixes two unrelated things gets two
files. A changeset is read by someone deciding whether to upgrade, so write the
consequence, not the diff: what broke, what they will now see instead. Keep it
self-contained — no PR numbers, issue links, or references to planning docs,
since it ships verbatim to npm where none of those resolve.

## Issue Labels

| Label | Meaning |
|-------|---------|
| `bug` | Confirmed bug with reproduction steps |
| `enhancement` | New feature or improvement |
| `good first issue` | Well-scoped, beginner-friendly |
| `needs-triage` | Not yet reviewed by a maintainer |
| `help wanted` | Maintainers welcome external contributions |
