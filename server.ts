import './src/config/env.ts';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/api/index.ts';
import { SyncManager } from './src/data/ingestion/syncManager.ts';
import { envConfig } from './src/config/env.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const PORT = Number(process.env.PORT) || envConfig.port;

console.log(`[PitchIntel] Environment: ${envConfig.nodeEnv} | Port: ${PORT}`);
console.log(`[PitchIntel] Database Mode: ${envConfig.database.provider}`);
console.log(`[PitchIntel] Canonical App URL: ${envConfig.appUrl}`);
console.log(`[PitchIntel] Zed Integration: ${envConfig.zedIntegration.apiUrl} (Secret configured: ${Boolean(envConfig.zedIntegration.serviceSecret)})`);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount REST API router
app.use('/api', apiRouter);

// Lazy seed base canonical data in background without blocking server listen
(async () => {
  try {
    const syncManager = new SyncManager();
    await syncManager.initBaseData();
    console.log('[Football Engine] Base canonical competitions and team aliases verified.');
    await syncManager.syncAll();
    const { LiveMatchEngine } = await import('./src/data/live/liveMatchEngine.ts');
    await LiveMatchEngine.getLiveMatches();
    console.log('[Football Engine] Live matches feed ready.');
  } catch (err: any) {
    console.warn('[Football Engine] Background data init notice:', err?.message || err);
  }
})();

// Full-stack Vite middleware integration
if (process.env.NODE_ENV !== 'production') {
  const enableHmr = process.env.ENABLE_HMR === 'true';
  if (!enableHmr) {
    // Vite 6 injects /@vite/client into index.html and CSS modules even when hmr/ws are false,
    // which causes createWebSocketModuleRunnerTransport to open a failing WebSocket in iframe previews.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`import "/@vite/env";
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const u = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (u.search ? "&" + u.search.slice(1) : "") + (u.hash || "");
}
export class ErrorOverlay extends HTMLElement {}
export function createHotContext(_ownerPath) {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
`);
    });
  }
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: enableHmr ? { server: httpServer } : false,
      ws: enableHmr ? {} : (false as const),
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Production static file serving
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Football Engine] Server listening on http://0.0.0.0:${PORT}`);
});
