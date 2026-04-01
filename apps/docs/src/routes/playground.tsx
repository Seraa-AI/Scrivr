import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Playground } from '@/playground/Playground';

export const Route = createFileRoute('/playground')({
  component: PlaygroundPage,
});

// The canvas editor is entirely client-side (canvas rendering, useLayoutEffect, random IDs).
// Render nothing on the server, mount after hydration to avoid all SSR mismatches.
function PlaygroundPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Playground />;
}
