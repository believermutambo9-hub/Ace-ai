import { db } from './index.ts';
import { sql } from 'drizzle-orm';

/**
 * PitchIntel Authoritative Database Verification & Diagnostic Client
 * Powered exclusively by Drizzle ORM over PostgreSQL.
 * Performs real `SELECT 1` queries to measure round-trip latency,
 * detects active public tables, and retrieves record metrics.
 */
export interface DbConnectionStatus {
  connected: boolean;
  ping: number;
  timestamp: string;
  serverVersion?: string;
  latencyMs: number;
  engine: string;
  connectionMethod: 'DATABASE_URL' | 'SQL_HOST_PARAMETERS';
  tablesDetected: number;
  error?: string;
}

export class DatabaseClient {
  private static instance: DatabaseClient | null = null;

  public static getInstance(): DatabaseClient {
    if (!this.instance) {
      this.instance = new DatabaseClient();
    }
    return this.instance;
  }

  /**
   * Performs a live database connection test using raw `SELECT 1` to measure
   * round-trip latency, server time, and connection health.
   */
  public async verifyConnection(): Promise<DbConnectionStatus> {
    const startTime = performance.now();
    try {
      const result = await db.execute<{
        ping: number;
        now: string;
        version: string;
        tables: number;
      }>(
        sql`
          SELECT 
            1 as ping,
            NOW() as now,
            version() as version,
            (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') as tables
        `
      );

      const latencyMs = Number((performance.now() - startTime).toFixed(1));
      const row = result.rows[0];

      return {
        connected: true,
        ping: row?.ping ?? 1,
        timestamp: row?.now || new Date().toISOString(),
        serverVersion: row?.version,
        latencyMs,
        engine: 'PostgreSQL (Cloud SQL / Persistent Instance)',
        connectionMethod: process.env.DATABASE_URL ? 'DATABASE_URL' : 'SQL_HOST_PARAMETERS',
        tablesDetected: Number(row?.tables || 0),
      };
    } catch (err: any) {
      const latencyMs = Number((performance.now() - startTime).toFixed(1));
      return {
        connected: false,
        ping: 0,
        timestamp: new Date().toISOString(),
        latencyMs,
        engine: 'PostgreSQL',
        connectionMethod: process.env.DATABASE_URL ? 'DATABASE_URL' : 'SQL_HOST_PARAMETERS',
        tablesDetected: 0,
        error: err?.message || 'Connection to database failed',
      };
    }
  }

  /**
   * Verified diagnostic summary of records in the PostgreSQL instance.
   */
  public async getRecordCounts() {
    const [comps, clubs, fixtures, predictions] = await Promise.all([
      db.execute<{ count: number }>(sql`SELECT count(*) as count FROM competitions`),
      db.execute<{ count: number }>(sql`SELECT count(*) as count FROM teams`),
      db.execute<{ count: number }>(sql`SELECT count(*) as count FROM matches`),
      db.execute<{ count: number }>(sql`SELECT count(*) as count FROM prediction_ledger`),
    ]);

    return {
      competitions: Number(comps.rows[0]?.count || 0),
      teams: Number(clubs.rows[0]?.count || 0),
      matches: Number(fixtures.rows[0]?.count || 0),
      predictionsInLedger: Number(predictions.rows[0]?.count || 0),
    };
  }
}

export const dbClient = DatabaseClient.getInstance();
