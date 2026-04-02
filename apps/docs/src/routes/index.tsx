import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-fd-background text-fd-foreground">
      {/* Nav */}
      <header className="flex items-center gap-6 px-8 py-4 border-b border-fd-border">
        <span className="font-mono text-sm font-semibold tracking-tight">Scrivr</span>
        <nav className="flex items-center gap-5 ml-auto text-sm text-fd-muted-foreground">
          <Link to="/docs/$" className="hover:text-fd-foreground transition-colors">
            Docs
          </Link>
          <Link to="/playground" className="hover:text-fd-foreground transition-colors">
            Playground
          </Link>
          <a
            href="https://github.com/Seraa-AI/Scrivr"
            target="_blank"
            rel="noreferrer"
            className="hover:text-fd-foreground transition-colors"
          >
            GitHub
          </a>
        </nav>
      </header>

      {/* Hero */}
      <main className="flex flex-col items-center justify-center flex-1 text-center px-6 py-24 gap-8">
        <div className="flex flex-col items-center gap-4 max-w-2xl">
          <span className="text-xs font-mono font-semibold tracking-widest uppercase text-fd-muted-foreground border border-fd-border rounded-full px-3 py-1">
            Open Beta
          </span>
          <h1 className="text-5xl font-bold tracking-tight leading-tight">
            A canvas-based<br />document editor
          </h1>
          <p className="text-lg text-fd-muted-foreground leading-relaxed max-w-lg">
            Scrivr renders documents onto HTML canvas — pixel-perfect pagination,
            real-time collaboration, and an AI writing assistant. Headless core,
            bring your own framework.
          </p>
        </div>

        {/* Install snippet */}
        <div className="flex items-center gap-2 bg-fd-card border border-fd-border rounded-lg px-5 py-3 font-mono text-sm">
          <span className="text-fd-muted-foreground select-none">$</span>
          <span>pnpm add @scrivr/core</span>
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <Link
            to="/docs/$"
            params={{ _splat: 'getting-started' }}
            className="inline-flex items-center gap-2 bg-fd-primary text-fd-primary-foreground rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Read the docs →
          </Link>
          <Link
            to="/playground"
            className="inline-flex items-center gap-2 bg-fd-card border border-fd-border text-fd-foreground rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-fd-accent transition-colors"
          >
            Open playground
          </Link>
        </div>

        {/* Framework adapters */}
        <div className="flex flex-col items-center gap-3 mt-4 w-full max-w-2xl">
          <span className="text-xs text-fd-muted-foreground uppercase tracking-widest font-mono">Framework adapters</span>
          <div className="flex flex-wrap justify-center gap-3 w-full">
            {ADAPTERS.map((a) => (
              <div
                key={a.name}
                className={`flex items-center gap-2.5 border rounded-lg px-4 py-2.5 text-sm font-medium ${
                  a.available
                    ? 'bg-fd-card border-fd-border text-fd-foreground'
                    : 'bg-fd-card/50 border-fd-border/50 text-fd-muted-foreground'
                }`}
              >
                <span>{a.icon}</span>
                <span>{a.name}</span>
                {!a.available && (
                  <span className="text-xs font-mono bg-fd-accent/30 text-fd-muted-foreground rounded px-1.5 py-0.5">
                    soon
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 max-w-2xl w-full text-left">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-fd-card border border-fd-border rounded-xl p-5 flex flex-col gap-2">
              <span className="text-xl">{f.icon}</span>
              <span className="font-semibold text-sm">{f.title}</span>
              <span className="text-xs text-fd-muted-foreground leading-relaxed">{f.description}</span>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-fd-muted-foreground py-6 border-t border-fd-border">
        Built by Seraa AI · Apache-2.0 License
      </footer>
    </div>
  );
}

const ADAPTERS = [
  { name: 'React', icon: '⚛️', available: true },
  { name: 'Vue', icon: '💚', available: false },
  { name: 'Svelte', icon: '🧡', available: false },
  { name: 'Vanilla JS', icon: '🟨', available: false },
];

const FEATURES = [
  {
    icon: '📄',
    title: 'Headless core',
    description: 'Framework-agnostic engine. Drop in the React adapter or wire up any UI layer yourself.',
  },
  {
    icon: '🤝',
    title: 'Real-time collaboration',
    description: 'Yjs CRDTs + Hocuspocus. Multiple cursors, presence, and conflict-free editing out of the box.',
  },
  {
    icon: '✨',
    title: 'AI writing assistant',
    description: 'Ghost text streaming, tracked-change suggestions, and document-context-aware Claude integration.',
  },
];
