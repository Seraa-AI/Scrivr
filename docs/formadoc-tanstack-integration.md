Fumadocs + Tailwind Migration for Inscribe

Context

The Inscribe demo app (apps/demo) is a TanStack Start + Vite app that currently uses inline styles exclusively (~500 lines across 7 files). Fumadocs officially supports TanStack Start (docs), so we can add a /docs route without a second app.

There are 6 existing markdown docs in docs/ that will become the initial content.

Since Fumadocs requires Tailwind CSS v4, we will migrate the entire editor UI from inline styles to Tailwind at the same time — giving us a unified styling approach across both the editor and docs.



Phase 1: Tailwind CSS v4 Setup + Editor Migration

Step 1: Install All Dependencies

In apps/demo, add everything at once:

pnpm add fumadocs-core fumadocs-ui fumadocs-mdx @types/mdx
pnpm add -D tailwindcss@4 @tailwindcss/vite

Step 2: Create Global Tailwind CSS File

Create apps/demo/src/styles/app.css:

@import 'tailwindcss';
@import 'fumadocs-ui/css/neutral.css';
@import 'fumadocs-ui/css/preset.css';

This is imported globally (in __root.tsx) so both editor and docs routes use Tailwind. The Fumadocs preset provides the docs theme; Tailwind utilities power the editor UI.

Step 3: Migrate Editor Components to Tailwind

Convert all 7 files from inline style={{}} objects to Tailwind utility classes. Migration order (by complexity, simplest first):

3a. __root.tsx — Replace inline <style> reset tag with Tailwind's preflight (automatic) and import styles/app.css.

3b. TrackChangesPopover.tsx (~35 lines) — Popover container, badges, accept/reject buttons. Dynamic left/top positioning stays as inline style (driven by pos.x/pos.y from mouse events).

3c. BubbleMenuBar.tsx (~40 lines) — Dark floating bar, mark buttons (bold/italic), active states, divider.

3d. Toolbar.tsx (~61 lines) — Toolbar bar, button groups, selects. Note: item.labelStyle from extension specs needs a dynamic class or stays inline.

3e. ModeSwitcher.tsx (~64 lines) — Dropdown trigger, backdrop overlay, menu items, active state.

3f. FloatingMenuBar.tsx (~66 lines) — Plus button with rotate transform, dropdown menu. Replace onMouseEnter/onMouseLeave JS hover with Tailwind hover: classes.

3g. App.tsx (~71 lines) — Shell layout, dark header, badge, toolbar row, body/main/canvas. Dynamic userColor stays as inline style on the dot element.

3h. ChatPanel.tsx (~162 lines) — Largest file. Panel layout, header, message bubbles (user/AI), tool cards, input area, send button. All standard layout/color patterns.

Migration rules for each file:





Delete the const styles = { ... } block at the bottom



Replace style={styles.foo} with className="..." using Tailwind equivalents



Keep inline styles only for truly dynamic values (computed positions, user-selected colors)



Replace JS-based hover (onMouseEnter/onMouseLeave) with hover: variants



Phase 2: Fumadocs Integration

Step 4: Create source.config.ts

Create apps/demo/source.config.ts:

import { defineDocs } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
});

Step 5: Update Vite Config

Update apps/demo/vite.config.ts to add the fumadocs-mdx plugin and Tailwind plugin:

import mdx from 'fumadocs-mdx/vite';
import tailwindcss from '@tailwindcss/vite';
import * as MdxConfig from './source.config';

export default defineConfig({
  plugins: [
    mdx(MdxConfig),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  // ... existing resolve aliases
});

Step 6: Add TypeScript Path Aliases

Update apps/demo/tsconfig.json:

{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "collections/*": [".source/*"]
    }
  }
}

Also add @/* as a Vite resolve alias in vite.config.ts.

Step 7: Create lib/source.ts

Create apps/demo/src/lib/source.ts:

import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

Step 8: Create Helper Files

apps/demo/src/components/mdx.tsx -- MDX component overrides:

import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, ...components } satisfies MDXComponents;
}
export const useMDXComponents = getMDXComponents;

apps/demo/src/lib/layout.shared.tsx -- Shared nav config:

import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return { nav: { title: 'Inscribe' } };
}

Step 9: Create the /docs/$ Route

Create apps/demo/src/routes/docs/$.tsx following the official TanStack Start guide:

createServerFn resolves the page from the source and serializes the page tree

browserCollections handles client-side MDX rendering with DocsPage, DocsTitle, DocsDescription, DocsBody

DocsLayout wraps the page with sidebar navigation

Step 10: Create Search API Route

Create apps/demo/src/routes/api/search.ts:

import { createFileRoute } from '@tanstack/react-router';
import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

const server = createFromSource(source, { language: 'english' });

export const Route = createFileRoute('/api/search')({
  server: {
    handlers: {
      GET: async ({ request }) => server.GET(request),
    },
  },
});

Step 11: Update Root Layout

Update apps/demo/src/routes/__root.tsx:





Import styles/app.css globally



Wrap children with RootProvider from fumadocs-ui/provider/tanstack



Remove the old inline <style> reset (Tailwind's preflight replaces it)



Add suppressHydrationWarning on <html> (needed for Fumadocs theme switching)

Step 12: Migrate Existing Docs to MDX

Create apps/demo/content/docs/ and convert the 6 existing markdown files:





docs/plan.md --> content/docs/architecture.mdx (Architecture)



docs/extensibility.md --> content/docs/extensibility.mdx (Extensibility)



docs/pageless-mode.md --> content/docs/pageless-mode.mdx (Pageless Mode)



docs/ai-toolkit.md --> content/docs/ai-toolkit.mdx (AI Toolkit)



docs/multi-author-tracked-changes.md --> content/docs/track-changes.mdx (Track Changes)



docs/phase-2.md --> content/docs/phase-2.mdx (Phase 2)

Each gets frontmatter (title, description) prepended. Also create:





content/docs/index.mdx -- Docs landing page ("Welcome to Inscribe docs")



content/docs/meta.json -- Sidebar ordering

Step 13: Add .source to .gitignore

The .source/ folder is auto-generated by fumadocs-mdx at build/dev time.





Architecture After Integration

graph TD
  subgraph TanStackApp ["TanStack Start App (apps/demo)"]
    CSS["styles/app.css (Tailwind + Fumadocs)"]
    Root["__root.tsx + RootProvider"]
    Root --> EditorRoute["/  Canvas Editor (Tailwind)"]
    Root --> DocsRoute["/docs/$  Fumadocs Layout"]
    Root --> AiApi["/api/ai"]
    Root --> SearchApi["/api/search"]
    DocsRoute --> MdxContent["content/docs/*.mdx"]
    DocsRoute --> SourceConfig["source.config.ts"]
    SourceConfig --> DotSource[".source/ (auto-generated)"]
  end



Risks and Mitigations





Tailwind preflight replacing the manual CSS reset -- Currently __root.tsx has a <style> tag for box-sizing and body { margin: 0 }. Tailwind's preflight handles both of these, so we simply remove the inline reset. No risk.



Dynamic inline styles -- A few values must remain as inline styles: TrackChangesPopover positioning (left/top from mouse coords), cursor dot color (userColor), and any item.labelStyle from extension specs. These are fine alongside Tailwind classes.



Bundle size -- Fumadocs UI components are only loaded on /docs routes (code-split by TanStack Router). The editor bundle is unaffected.



SSR for docs content -- Fumadocs uses server functions for page resolution, which aligns with TanStack Start's SSR model. The editor route already guards against SSR with a client-only mount.



Execution Order Summary

Phase 1 (Steps 1-3): Install deps, set up Tailwind, migrate all 7 editor components. After this, the editor works identically but uses Tailwind classes.

Phase 2 (Steps 4-13): Add Fumadocs config, create docs route, migrate markdown content. After this, /docs serves the documentation site.