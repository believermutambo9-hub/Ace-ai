import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { OpenFootballProvider } from '../../data/providers/openFootballProvider.ts';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    // 1. Check PostgreSQL connectivity
    const dbResult = await db.execute<{ now: string; count: number }>(
      sql`SELECT NOW() as now, (SELECT count(*) FROM matches) as count`
    );

    // 2. Query record counts across key tables
    const competitionsResult = await db.execute<{ count: number }>(sql`SELECT count(*) as count FROM competitions`);
    const teamsResult = await db.execute<{ count: number }>(sql`SELECT count(*) as count FROM teams`);
    const matchesResult = await db.execute<{ count: number }>(sql`SELECT count(*) as count FROM matches`);
    const predictionsResult = await db.execute<{ count: number }>(sql`SELECT count(*) as count FROM prediction_ledger`);

    const dbTime = dbResult.rows[0]?.now;
    const competitionsCount = competitionsResult.rows[0]?.count;
    const teamsCount = teamsResult.rows[0]?.count;
    const matchesCount = matchesResult.rows[0]?.count;
    const predictionsCount = predictionsResult.rows[0]?.count;

    // 3. Provider health check
    const provider = new OpenFootballProvider();
    const providerHealth = await provider.checkHealth();

    res.json({
      status: 'HEALTHY',
      service: 'Worldwide Football Intelligence & Prediction Engine',
      version: '1.0.0-foundation',
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startTime,
      database: {
        status: 'CONNECTED',
        engine: 'Cloud SQL PostgreSQL',
        currentDbTime: dbTime,
        records: {
          competitions: Number(competitionsCount || 0),
          teams: Number(teamsCount || 0),
          matches: Number(matchesCount || 0),
          predictionsInLedger: Number(predictionsCount || 0),
        },
      },
      providers: [providerHealth],
    });
  } catch (error: any) {
    console.error('Health check failure:', error);
    res.status(503).json({
      status: 'DEGRADED',
      service: 'Worldwide Football Intelligence & Prediction Engine',
      timestamp: new Date().toISOString(),
      error: error.message || 'Database or service check failed',
      responseTimeMs: Date.now() - startTime,
    });
  }
});
