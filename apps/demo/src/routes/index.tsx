import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { App } from "../App";

// The canvas editor is entirely client-side (canvas rendering, useLayoutEffect, random IDs).
// Render nothing on the server, mount after hydration to avoid all SSR mismatches.
function ClientApp() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <App />;
}

export const Route = createFileRoute("/")({
  component: ClientApp,
});
