import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-fd-background text-fd-foreground">
      {/* Nav */}
      <header className="flex items-center gap-6 px-8 py-4 border-b border-fd-border">
        <span className="font-mono text-sm font-semibold tracking-tight">Inscribe</span>
        <nav className="flex items-center gap-5 ml-auto text-sm text-fd-muted-foreground">
          <Link to="/docs/$" className="hover:text-fd-foreground transition-colors">
            Docs
          </Link>
          <Link to="/playground" className="hover:text-fd-foreground transition-colors">
            Playground
          </Link>
          <a
            href="https://github.com/Seraa-AI/Inscribe"
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
            Inscribe renders documents onto HTML canvas — pixel-perfect pagination,
            real-time collaboration, and an AI writing assistant. Built for React.
          </p>
        </div>

        {/* Install snippet */}
        <div className="flex items-center gap-2 bg-fd-card border border-fd-border rounded-lg px-5 py-3 font-mono text-sm">
          <span className="text-fd-muted-foreground select-none">$</span>
          <span>pnpm add @inscribe/core @inscribe/react</span>
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

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 max-w-2xl w-full text-left">
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
        Built with Inscribe · MIT License
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    icon: '📄',
    title: 'Canvas rendering',
    description: 'Pages render to HTML canvas — precise layout, custom fonts, and pixel-perfect pagination.',
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
