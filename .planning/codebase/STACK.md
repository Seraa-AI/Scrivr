# Technology Stack

**Analysis Date:** 2025-03-27

## Languages

**Primary:**
- TypeScript v5.4.0 (Core & Demo) / v6.0.2 (Docs) - Used for all packages and applications.

**Secondary:**
- JavaScript (Node.js) - For build scripts and runtime.

## Runtime

**Environment:**
- Node.js (via pnpm)
- Environment Variables: Managed via Vite/Nitro/Node.js processes.

**Package Manager:**
- pnpm v10.32.1
- Lockfile: `pnpm-lock.yaml` (present)
- Monorepo Management: pnpm-workspace.yaml

## Frameworks

**Core:**
- React v18.3.0 (Demo/App) / v19.2.4 (Docs) - UI framework.
- ProseMirror v1.x - The foundational rich text editor engine.
- Yjs v13.6.30 - CRDT for real-time collaboration.
- TanStack Router/Start v1.168.x - Routing and SSR framework.

**Testing:**
- Vitest v2.0.0 - Primary testing runner.
- Happy DOM v20.8.4 - DOM simulation for tests.
- Vitest Canvas Mock v1.1.3 - For testing canvas-based rendering in `packages/core`.

**Build/Dev:**
- Turbo v2.8.20 - Monorepo task orchestration.
- Vite v7.3.1 (Demo) / v8.0.2 (Docs) - Development server and frontend bundler.
- tsup v8.0.0 - Bundler for TypeScript packages in `packages/`.
- Nitro v3.0.x - Server engine for `apps/docs`.

## Key Dependencies

**Critical:**
- `@hocuspocus/server` & `@hocuspocus/provider` - WebSocket-based collaboration backend and client.
- `ai` / `@ai-sdk/react` / `@ai-sdk/anthropic` - Vercel AI SDK integration for Claude/Anthropic.
- `pdf-lib` v1.17.1 - Used for PDF export in `@inscribe/export`.
- `markdown-it` v14.1.1 - Markdown parsing library.

**Infrastructure:**
- `zod` v4.3.6 - Schema validation for AI tools and data structures.
- `@floating-ui/dom` v1.7.6 - Positioning for menus and popovers.
- `lucide-react` v1.6.0 - Icon set.

## Configuration

**Environment:**
- Configured via `.env` files (referenced in code: `VITE_WS_URL`).
- Built-in configurations for `turbo`, `tsconfig`, and `package.json` workspaces.

**Build:**
- `turbo.json`: Task pipeline definition.
- `tsconfig.base.json`: Base TypeScript configuration shared across the project.
- `tsup.config.ts`: Configuration for package builds.

## Platform Requirements

**Development:**
- Node.js and pnpm installed locally.
- Access to WebSocket port (default 1234) for local collaboration server.

**Production:**
- Node.js environment for the collaboration server and documentation server.
- Static hosting or SSR-capable environment for the demo application.

---

*Stack analysis: 2025-03-27*
