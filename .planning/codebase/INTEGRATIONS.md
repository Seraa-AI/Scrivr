# External Integrations

**Analysis Date:** 2025-03-27

## APIs & External Services

**AI Services:**
- Anthropic Claude - LLM backend for the AI writing assistant.
  - SDK: `ai` / `@ai-sdk/anthropic` / `@anthropic-ai/sdk`
  - Auth: `ANTHROPIC_API_KEY` (Required for server-side AI handlers in `apps/demo/src/routes/api/ai.ts`)

## Data Storage

**Collaboration & Persistence:**
- Hocuspocus Server - Real-time state synchronization via WebSocket.
  - Connection: `VITE_WS_URL` (env var) - default `ws://localhost:1234`
  - Persistence: Local filesystem in `apps/server/data/` as binary Yjs updates.
  - Client: `@hocuspocus/provider` in `@inscribe/core`.

**File Storage:**
- Local filesystem only - Persistence is handled by the collaboration server.

**Caching:**
- None detected.

## Authentication & Identity

**Auth Provider:**
- Custom / URL-based - User identity is derived from URL parameters for development.
  - Implementation: `apps/demo/src/App.tsx` uses `room`, `user`, and `color` from `window.location.search`.

## Internal Package Dependencies

**Core Engine:**
- `@inscribe/core` - The main canvas-based editor core.
- `@inscribe/react` - React components and hooks for building editor UIs.

**Feature Packages:**
- `@inscribe/plugins` - Modular extensions including AI Toolkit and Track Changes.
- `@inscribe/export` - PDF and Markdown export capabilities.

## Monitoring & Observability

**Error Tracking:**
- None detected.

**Logs:**
- Console logging in development and server processes.

## CI/CD & Deployment

**Hosting:**
- Not explicitly configured for production (Vite-based frontend, Node.js backend).

**CI Pipeline:**
- Turbo-orchestrated tests and builds in the root `package.json`.

## Environment Configuration

**Required env vars:**
- `VITE_WS_URL`: Address of the collaboration server (Frontend).
- `ANTHROPIC_API_KEY`: API key for Claude (Backend API route).

**Secrets location:**
- Not explicitly stored in the codebase; assumed to be managed via `.env` or CI secrets.

## Webhooks & Callbacks

**Incoming:**
- `/api/ai` (POST) - AI streaming endpoint handled by TanStack Start in `apps/demo`.

**Outgoing:**
- AI tool execution results are streamed back to the client via `createUIMessageStreamResponse`.

---

*Integration audit: 2025-03-27*
