import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** ── Storage directory */

/** Resolve relative to this file's location so the path is correct regardless
 * of which directory the server process is started from.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

console.log(`[boot] DATA_DIR = ${DATA_DIR}`);
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[boot] data dir ready`);
} catch (err) {
  console.error(`[boot] failed to create data dir:`, err);
  process.exit(1);
}

function docPath(name: string): string {
  // Sanitise to prevent path traversal — keep only alphanumeric, dash, underscore, dot
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(DATA_DIR, `${safe}.bin`);
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = Server.configure({
  port: 1235,

  async onLoadDocument({ document, documentName }) {
    const file = docPath(documentName);
    console.log(`[load] ${documentName} — looking for ${file}`);
    if (fs.existsSync(file)) {
      const update = fs.readFileSync(file);
      Y.applyUpdate(document, update);
      console.log(`[load] restored ${documentName} (${update.byteLength} B)`);
    } else {
      console.log(`[load] no saved file — new doc "${documentName}"`);
    }
  },

  async onStoreDocument({ document, documentName }) {
    const update = Y.encodeStateAsUpdate(document);
    const file = docPath(documentName);
    console.log(`[store] ${documentName} — writing ${update.byteLength} B to ${file}`);
    try {
      fs.writeFileSync(file, update);
      console.log(`[store] ${documentName} — saved OK`);
    } catch (err) {
      console.error(`[store] ${documentName} — FAILED:`, err);
    }
  },

  async onConnect({ documentName }) {
    console.log(`[connect] + ${documentName}`);
  },

  async onDisconnect({ documentName, clientsCount }) {
    console.log(`[disconnect] - ${documentName} (${clientsCount} remaining)`);
  },
});

server.listen();
console.log("Scrivr collaboration server listening on ws://localhost:1234");
console.log(`Documents persisted to: ${DATA_DIR}`);
