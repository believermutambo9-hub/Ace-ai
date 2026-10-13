import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './src/api/index.ts';
import { SyncManager } from './src/data/ingestion/syncManager.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const PORT = 3000;

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
    console.log('[Football Engine] Worldwide leagues initialized successfully.');
    const { LiveMatchEngine } = await import('./src/data/live/liveMatchEngine.ts');
    await LiveMatchEngine.ensureLiveMatches();
    console.log('[Football Engine] Live matches dashboard feed ready.');
  } catch (err: any) {
    console.warn('[Football Engine] Background data init notice:', err?.message || err);
  }
})();

// Full-stack Vite middleware integration
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
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
