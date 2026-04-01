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
6. Open a Pull Request against `main` with a clear description of what changed and why.
7. A maintainer will review your PR, request changes if needed, and merge when ready.

## Issue Labels

| Label | Meaning |
|-------|---------|
| `bug` | Confirmed bug with reproduction steps |
| `enhancement` | New feature or improvement |
| `good first issue` | Well-scoped, beginner-friendly |
| `needs-triage` | Not yet reviewed by a maintainer |
| `help wanted` | Maintainers welcome external contributions |
