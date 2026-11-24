import { Router, Request, Response } from 'express';
import { healthRouter } from './routes/health.ts';
import { competitionsRouter } from './routes/competitions.ts';
import { teamsRouter } from './routes/teams.ts';
import { matchesRouter } from './routes/matches.ts';
import { predictRouter } from './routes/predict.ts';
import { upcomingRouter } from './routes/upcoming.ts';
import { performanceRouter, predictionHistoryRouter } from './routes/performance.ts';
import { sourcesRouter } from './routes/sources.ts';
import { standingsRouter } from './routes/standings.ts';
import { newsRouter } from './routes/news.ts';
import { h2hRouter } from './routes/h2h.ts';
import { zedRouter } from './routes/zed.ts';
import { historicalRouter } from './routes/historical.ts';
import { SyncManager } from '../data/ingestion/syncManager.ts';
import { LiveMatchEngine } from '../data/live/liveMatchEngine.ts';

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
apiRouter.use('/performance', performanceRouter);
apiRouter.use('/prediction-history', predictionHistoryRouter);
apiRouter.use('/data-sources', sourcesRouter);
apiRouter.use('/standings', standingsRouter);
apiRouter.use('/news', newsRouter);
apiRouter.use('/h2h', h2hRouter);
apiRouter.use('/historical', historicalRouter);

apiRouter.get('/live-feed', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const snapshot = await LiveMatchEngine.getLiveWebFeedSnapshot(forceRefresh);
    res.json(snapshot);
  } catch (error: any) {
    console.error('Failed to get live web feed:', error);
    res.status(500).json({ error: error.message || 'Failed to get live web feed' });
  }
});

// Versioned Server-to-Server integration for Zed
apiRouter.use('/v1/zed', zedRouter);
apiRouter.use('/zed', zedRouter);

// Form alias endpoint for team performance queries
apiRouter.get('/form/:teamId', (req: Request, res: Response) => {
  res.redirect(307, `/api/teams/${req.params.teamId}/form`);
});

import { WalkForwardBacktester } from '../backtesting/walkForwardValidator.ts';
import { requireAdminOrService } from '../middleware/auth.ts';

// Backtests summary endpoint - calculates metrics strictly from verified historical fixtures
apiRouter.get('/backtests', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const backtest = await WalkForwardBacktester.runBacktest({ limit });

    res.json({
      status: 'SUCCESS',
      framework: 'Walk-Forward Historical Chronological Validator',
      modelVersion: 'football-engine-v2.0-full-intelligence',
      lastEvaluation: new Date().toISOString(),
      evaluatedTimeRange: {
        earliest: backtest.testedTimeRange.start.toISOString(),
        latest: backtest.testedTimeRange.end.toISOString(),
      },
      metrics: {
        sampleSize: backtest.totalMatchesTested,
        brierScore: backtest.avgBrierScore,
        logLoss: backtest.avgLogLoss,
        accuracy: backtest.overallAccuracy,
        baselineComparison: {
          naiveHomeWinBaseline: backtest.naiveHomeWinBaseline,
          uniformRandomBaseline: 0.333,
          edgeOverNaive: Number((backtest.overallAccuracy - backtest.naiveHomeWinBaseline).toFixed(3)),
        },
      },
      modelComparison: backtest.modelComparison,
      breakdownByMarket: {
        homeWinAccuracy: backtest.homeWinAccuracy,
        drawAccuracy: backtest.drawAccuracy,
        awayWinAccuracy: backtest.awayWinAccuracy,
      },
      marketsTested: ['1X2 Match Result', 'Expected Goals (xG)'],
      futureDataLeakagePrevention: 'STRICT_PRE_KICKOFF_ONLY',
    });
  } catch (err: any) {
    console.error('Backtest calculation error:', err);
    res.status(500).json({ error: err?.message || 'Failed to compute walk-forward backtest' });
  }
});

// Sync trigger endpoint - Protected by Firebase Admin or Service Secret authentication
apiRouter.post('/sync', requireAdminOrService, async (_req: Request, res: Response) => {
  try {
    const syncManager = new SyncManager();
    const results = await syncManager.syncAll();
    res.json({ message: 'Sync completed successfully', results });
  } catch (error: any) {
    console.error('Manual sync failed:', error);
    res.status(500).json({ error: error.message || 'Sync failed' });
  }
});

// JSON 404 catch-all so unmatched /api/* endpoints never fall through to SPA HTML
apiRouter.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

