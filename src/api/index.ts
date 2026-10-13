import { Router, Request, Response } from 'express';
import { healthRouter } from './routes/health.ts';
import { competitionsRouter } from './routes/competitions.ts';
import { teamsRouter } from './routes/teams.ts';
import { matchesRouter } from './routes/matches.ts';
import { predictRouter } from './routes/predict.ts';
import { upcomingRouter } from './routes/upcoming.ts';
import { performanceRouter, predictionHistoryRouter } from './routes/performance.ts';
import { sourcesRouter } from './routes/sources.ts';
import { SyncManager } from '../data/ingestion/syncManager.ts';

export const apiRouter = Router();

// Mount all API endpoints
apiRouter.use('/health', healthRouter);
apiRouter.use('/competitions', competitionsRouter);
apiRouter.use('/teams', teamsRouter);
apiRouter.use('/matches', matchesRouter);
apiRouter.use('/upcoming', upcomingRouter);
apiRouter.use('/predict', predictRouter);
apiRouter.use('/predictions', upcomingRouter);
apiRouter.use('/model-performance', performanceRouter);
apiRouter.use('/prediction-history', predictionHistoryRouter);
apiRouter.use('/data-sources', sourcesRouter);

// Sync trigger endpoint
apiRouter.post('/sync', async (_req: Request, res: Response) => {
  try {
    const syncManager = new SyncManager();
    const results = await syncManager.syncAll();
    res.json({ message: 'Sync completed successfully', results });
  } catch (error: any) {
    console.error('Manual sync failed:', error);
    res.status(500).json({ error: error.message || 'Sync failed' });
  }
});
