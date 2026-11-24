import { Router, Request, Response } from 'express';
import { desc } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { ingestionLogs } from '../../db/schema.ts';
import { OpenFootballProvider } from '../../data/providers/openFootballProvider.ts';
import { ApiFootballProvider } from '../../data/providers/apiFootballProvider.ts';
import { FootballDataProvider } from '../../data/providers/footballDataProvider.ts';
import { LiveWebFeedProvider } from '../../data/providers/liveWebFeedProvider.ts';
import { NewsEngine } from '../../data/news/newsEngine.ts';
import { SyncManager } from '../../data/ingestion/syncManager.ts';
import { zedAuthMiddleware } from '../../middleware/zedAuth.ts';

export const sourcesRouter = Router();

// GET /api/data-sources - Health & status of all configured football data providers
sourcesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const openProvider = new OpenFootballProvider();
    const apiFootballProvider = new ApiFootballProvider();
    const footballDataProvider = new FootballDataProvider();
    const liveWebFeedProvider = new LiveWebFeedProvider();

    const [openHealth, apiFootballHealth, footballDataHealth, liveWebHealth, newsHealth] = await Promise.all([
      openProvider.checkHealth(),
      apiFootballProvider.checkHealth(),
      footballDataProvider.checkHealth(),
      liveWebFeedProvider.checkHealth(),
      NewsEngine.checkHealth(),
    ]);

    const recentLogs = await db
      .select()
      .from(ingestionLogs)
      .orderBy(desc(ingestionLogs.timestamp))
      .limit(20);

    res.json({
      activePrimary: footballDataHealth.isOnline
        ? 'football-data-org'
        : liveWebHealth.isOnline
        ? 'live-web-feed'
        : apiFootballHealth.isOnline
        ? 'api-football-v3'
        : 'open-football',
      providers: [
        {
          id: 'football-data-org',
          name: 'Football-Data.org (API v4 Direct)',
          tier: 'PRIMARY_ACTIVE',
          coverage: '13 Major Global Competitions (PL, CL, BL1, SA, PD, FL1, etc.)',
          status: footballDataHealth.isOnline ? 'OPERATIONAL' : 'OFFLINE',
          latencyMs: footballDataHealth.latencyMs,
          lastChecked: footballDataHealth.lastChecked,
          message: footballDataHealth.message,
          authenticated: Boolean(process.env.FOOTBALL_DATA_API_KEY),
        },
        {
          id: 'live-web-feed',
          name: 'Global Live Web Scoreboard Feed',
          tier: 'PRIMARY_LIVE_WEB',
          coverage: '20+ Live Global Leagues, In-Play Clocks, Events & Team Stats (Key-Free)',
          status: liveWebHealth.isOnline ? 'OPERATIONAL' : 'OFFLINE',
          latencyMs: liveWebHealth.latencyMs,
          lastChecked: liveWebHealth.lastChecked,
          message: liveWebHealth.message,
          authenticated: true,
        },
        {
          id: 'api-football-v3',
          name: 'API-Sports (API-Football v3 Direct)',
          tier: 'SECONDARY_LIVE',
          coverage: 'Worldwide Multi-Tier Leagues (Direct api-sports.io)',
          status: apiFootballHealth.isOnline ? 'OPERATIONAL' : 'OFFLINE',
          latencyMs: apiFootballHealth.latencyMs,
          lastChecked: apiFootballHealth.lastChecked,
          message: apiFootballHealth.message,
          authenticated: Boolean(process.env.API_FOOTBALL_KEY),
        },
        {
          id: 'open-football',
          name: 'Open Football Data Pipeline (CDN)',
          tier: 'FALLBACK_REPOSITORY',
          coverage: 'Worldwide Historical & Schedule Feeds',
          status: openHealth.isOnline ? 'OPERATIONAL' : 'OFFLINE',
          latencyMs: openHealth.latencyMs,
          lastChecked: openHealth.lastChecked,
          message: openHealth.message,
          authenticated: true,
        },
        {
          id: 'web-intelligence',
          name: 'Live Football RSS, ESPN & Injury Feeds',
          tier: 'SUPPORTING_INTELLIGENCE',
          coverage: 'BBC Sport, Sky Sports, The Guardian & ESPN Global Soccer',
          status: newsHealth.status,
          articlesCached: newsHealth.articlesCached,
          activeSources: newsHealth.activeSources,
          failedSources: newsHealth.failedSources,
          lastChecked: new Date().toISOString(),
          message:
            newsHealth.activeSources.length > 0
              ? `${newsHealth.activeSources.length} live news feeds operational (${newsHealth.articlesCached} articles)`
              : 'All news feeds unreachable',
          authenticated: true,
        },
      ],
      recentIngestionLogs: recentLogs,
    });
  } catch (error: any) {
    console.error('Failed to get data sources:', error);
    res.status(500).json({ error: error.message || 'Failed to get data sources' });
  }
});

// POST /api/data-sources/sync - Trigger sync with authenticated provider (Protected)
sourcesRouter.post('/sync', zedAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { provider = 'football-data', competitionCode = 'PL', seasonCode = '2024-2025' } = req.body || {};

    let selectedProvider;
    if (provider === 'football-data' || provider === 'football-data-org') {
      selectedProvider = new FootballDataProvider();
    } else if (provider === 'live-web-feed') {
      selectedProvider = new LiveWebFeedProvider();
    } else if (provider === 'api-football' || provider === 'api-football-v3') {
      selectedProvider = new ApiFootballProvider();
    } else {
      selectedProvider = new OpenFootballProvider();
    }

    const syncMgr = new SyncManager(selectedProvider);
    await syncMgr.initBaseData();
    const summary = await syncMgr.syncCompetitionMatches(competitionCode, seasonCode);

    res.json({
      success: true,
      provider: selectedProvider.name,
      competitionCode,
      seasonCode,
      summary,
    });
  } catch (error: any) {
    console.error('Provider sync failed:', error);
    res.status(500).json({ error: error.message || 'Provider sync failed' });
  }
});

// POST /api/data-sources/sync-all-history - Mass Ingestion of all historical matches (Protected)
sourcesRouter.post('/sync-all-history', zedAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const { ComprehensiveHistoryIngestion } = await import('../../data/ingestion/comprehensiveHistoryIngestion.ts');
    // Start asynchronous mass ingestion
    ComprehensiveHistoryIngestion.ingestAllHistoricalMatches().catch((err) => {
      console.error('Background mass ingestion failed:', err);
    });

    res.json({
      success: true,
      status: 'MASS_INGESTION_STARTED',
      message: 'Comprehensive multi-season history ingestion started in background across OpenFootball archives and live feeds.',
    });
  } catch (error: any) {
    console.error('Failed to trigger mass ingestion:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger mass ingestion' });
  }
});
