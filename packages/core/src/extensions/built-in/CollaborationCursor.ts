/**
 * CollaborationCursor — draws remote users' cursors on the overlay canvas.
 *
 * Depends on the Collaboration extension being present (reads awareness from
 * the same HocusPocus provider).
 *
 * Usage:
 *   CollaborationCursor.configure({
 *     user: { name: "Alice", color: "#ef4444" },
 *   })
 */
import { Extension } from "../Extension";
import type { IEditor, OverlayRenderHandler } from "../types";
import { collaborationRegistry } from "../collaborationState";

interface CollaborationCursorOptions {
  user?: { name: string; color: string };
}

export const CollaborationCursor = Extension.create<CollaborationCursorOptions>({
  name: "collaborationCursor",

  defaultOptions: {
    user: { name: "Anonymous", color: "#3b82f6" },
  },

  onEditorReady(editor: IEditor) {
    const collab = collaborationRegistry.get(editor);
    if (!collab) {
      console.warn(
        "[CollaborationCursor] Collaboration extension not found — " +
          "add Collaboration before CollaborationCursor in extensions array."
      );
      return;
    }

    const { provider } = collab;
    const awareness = provider.awareness;
    const user = this.options.user ?? { name: "Anonymous", color: "#3b82f6" };

    if (!awareness) {
      console.warn("[CollaborationCursor] Provider awareness is not available.");
      return;
    }

    // Announce this client's identity
    awareness.setLocalStateField("user", user);

    // Broadcast local cursor position on every state change
    const broadcastCursor = () => {
      const { anchor, head } = editor.getState().selection;
      awareness.setLocalStateField("cursor", { anchor, head });
    };
    const unsubscribe = editor.subscribe(broadcastCursor);
    broadcastCursor();

    // ── Overlay render handler — draws remote cursors ─────────────────────────
    const renderRemoteCursors: OverlayRenderHandler = (ctx, pageNumber, _pageConfig, charMap) => {
      ctx.save();

      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;

        const cursor = state["cursor"] as { anchor: number; head: number } | undefined;
        const remoteUser = state["user"] as { name: string; color: string } | undefined;
        if (!cursor || !remoteUser) return;

        const coords = charMap.coordsAtPos(cursor.head);
        if (!coords || coords.page !== pageNumber) return;

        const x = Math.round(coords.x) + 0.5;
        const { color, name } = remoteUser;

        // Cursor line
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, coords.y + 1);
        ctx.lineTo(x, coords.y + coords.height - 1);
        ctx.stroke();
        ctx.restore();

        // Name label above the cursor
        ctx.save();
        ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
        const textMetrics = ctx.measureText(name);
        const pad = 4;
        const labelW = textMetrics.width + pad * 2;
        const labelH = 16;
        const labelX = coords.x;
        const labelY = Math.max(0, coords.y - labelH - 2);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect?.(labelX, labelY, labelW, labelH, 3);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(name, labelX + pad, labelY + labelH - 4);
        ctx.restore();
      });

      ctx.restore();
    };

    const unregister = editor.addOverlayRenderHandler(renderRemoteCursors);

    // Repaint the overlay whenever any peer's cursor changes
    const onAwarenessChange = () => editor.redraw();
    awareness.on("change", onAwarenessChange);

    return () => {
      unsubscribe();
      unregister();
      awareness.off("change", onAwarenessChange);
    };
  },
});
