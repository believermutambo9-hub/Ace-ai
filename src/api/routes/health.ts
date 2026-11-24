import { Router, Request, Response } from 'express';
import { dbClient } from '../../db/databaseClient.ts';
import { OpenFootballProvider } from '../../data/providers/openFootballProvider.ts';
import { ApiFootballProvider } from '../../data/providers/apiFootballProvider.ts';
import { FootballDataProvider } from '../../data/providers/footballDataProvider.ts';
import { LiveWebFeedProvider } from '../../data/providers/liveWebFeedProvider.ts';
import { NewsEngine } from '../../data/news/newsEngine.ts';
import { db } from '../../db/index.ts';
import { matches, ingestionLogs, backfillJobs } from '../../db/schema.ts';
import { desc } from 'drizzle-orm';

export const healthRouter = Router();

// GET /api/health - Comprehensive system & verified database health check
healthRouter.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const [dbStatus, counts, newsHealth] = await Promise.all([
      dbClient.verifyConnection(),
      dbClient.getRecordCounts(),
      NewsEngine.checkHealth(),
    ]);

    const providerHealthPromises: Promise<any>[] = [
      new LiveWebFeedProvider().checkHealth(),
      new OpenFootballProvider().checkHealth(),
    ];
    if (process.env.API_FOOTBALL_KEY) {
      providerHealthPromises.push(new ApiFootballProvider().checkHealth());
    }
    if (process.env.FOOTBALL_DATA_API_KEY) {
      providerHealthPromises.push(new FootballDataProvider().checkHealth());
    }

    const providerHealthList = await Promise.all(providerHealthPromises);

    const [latestMatch] = await db
      .select({ kickoffTime: matches.kickoffTime, updatedAt: matches.updatedAt })
      .from(matches)
      .orderBy(desc(matches.updatedAt))
      .limit(1);

    const [latestSync] = await db
      .select()
      .from(ingestionLogs)
      .orderBy(desc(ingestionLogs.timestamp))
      .limit(1);

    const recentBackfillJobs = await db
      .select({
        id: backfillJobs.id,
        jobType: backfillJobs.jobType,
        providerSource: backfillJobs.providerSource,
        status: backfillJobs.status,
        insertedCount: backfillJobs.insertedCount,
        completedAt: backfillJobs.completedAt,
      })
      .from(backfillJobs)
      .orderBy(desc(backfillJobs.id))
      .limit(10);

    const apiFootballHealthy = providerHealthList.some(
      (p) => p.providerName === 'api-football-v3' && p.isOnline
    );
    const isSystemHealthy = dbStatus.connected && providerHealthList.some((p) => p.isOnline);

    res.json({
      status: isSystemHealthy ? 'HEALTHY' : 'DEGRADED',
      service: 'PitchIntel Worldwide Football Intelligence & Prediction Engine',
      version: '2.5.0-production',
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startTime,
      database: {
        status: dbStatus.connected ? 'CONNECTED' : 'DISCONNECTED',
        verified: dbStatus.connected,
        liveConnectionTest: 'SELECT 1',
        pingResult: dbStatus.ping,
        latencyMs: dbStatus.latencyMs,
        engine: dbStatus.engine,
        connectionMethod: dbStatus.connectionMethod,
        currentDbTime: dbStatus.timestamp,
        serverVersion: dbStatus.serverVersion,
        tablesDetected: dbStatus.tablesDetected,
        records: counts,
      },
      providers: providerHealthList,
      webSearch: {
        status: newsHealth.status,
        articlesCached: newsHealth.articlesCached,
        activeRssSources: newsHealth.activeSources,
        failedRssSources: newsHealth.failedSources,
        verifiedAbsencesSupported: apiFootballHealthy,
      },
      backfillJobs: {
        recentCount: recentBackfillJobs.length,
        runningCount: recentBackfillJobs.filter((j) => j.status === 'RUNNING').length,
        latestJob: recentBackfillJobs[0] || null,
      },
      provenance: {
        latestMatchTimestamp: latestMatch?.kickoffTime || null,
        latestDataUpdate: latestMatch?.updatedAt || null,
        lastSuccessfulSync: latestSync?.timestamp || null,
        lastSyncStatus: latestSync?.status || 'INITIALIZED',
      },
    });
  } catch (error: any) {
    console.error('Health check failure:', error);
    res.status(503).json({
      status: 'DEGRADED',
      service: 'PitchIntel Worldwide Football Intelligence & Prediction Engine',
      timestamp: new Date().toISOString(),
      error: error.message || 'Database or service check failed',
      database: {
        status: 'DISCONNECTED',
        verified: false,
        error: error.message,
      },
      responseTimeMs: Date.now() - startTime,
    });
  }
});

// GET /api/health/db or /api/health/database - Dedicated endpoint returning verified PostgreSQL connection status
healthRouter.get(['/db', '/database'], async (_req: Request, res: Response) => {
  try {
    const status = await dbClient.verifyConnection();
    const counts = status.connected ? await dbClient.getRecordCounts() : null;

    res.status(status.connected ? 200 : 503).json({
      database: 'PostgreSQL',
      ...status,
      records: counts,
    });
  } catch (error: any) {
    res.status(503).json({
      database: 'PostgreSQL',
      status: 'DISCONNECTED',
      verified: false,
      error: error.message,
    });
  }
});
